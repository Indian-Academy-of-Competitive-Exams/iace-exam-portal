import { Injectable } from '@nestjs/common';
import { type ImportLog, type Prisma, type RowActionLog } from '@prisma/client';
import {
  AUDIT_ACTOR_TYPE,
  AppException,
  ErrorCodes,
  dateOnlySchema,
  type AuditAction,
  type AuditFeature,
  type ImportLogStatus,
  type ImportLogSummary,
  type Paginated,
  type PaginationQuery,
  type RowAction,
  type RowActionListQuery,
} from '@iace/contracts';
import { endOfInstituteDay, startOfInstituteDay } from '../common/time/institute-day';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { type AuditRowActionEvent } from '../common/events/event-catalog';

/** Enough of the authenticated caller to scope a read — never the whole `AuthenticatedUser`. */
export interface AuditViewer {
  id: string;
  isSuperAdmin: boolean;
  isActive: boolean;
}

/** A calendar-day bound. `rowActionListQuerySchema` already rejects anything else; this is what
 *  keeps a direct caller from reaching Prisma with an Invalid Date. */
function parseDateOnlyBound(value: string, field: 'from' | 'to'): Date {
  const bound = field === 'from' ? startOfInstituteDay : endOfInstituteDay;
  const parsed = dateOnlySchema.safeParse(value).success ? bound(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    const message = `${field} must be a date in YYYY-MM-DD form`;
    throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
      fieldErrors: { [field]: [message] },
    });
  }
  return parsed;
}

/** An inclusive-both-ends window over `createdAt`, or nothing if neither bound was given. */
function dateRange(
  from: string | undefined,
  to: string | undefined,
): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: parseDateOnlyBound(from, 'from') } : {}),
    ...(to ? { lte: parseDateOnlyBound(to, 'to') } : {}),
  };
}

/** Owns `RowActionLog` — the only module that writes it. */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** `changed` on a CREATE is not a snapshot: `fieldDiff` drops a field that is null on both sides. */
  async record(event: AuditRowActionEvent): Promise<void> {
    await this.prisma.rowActionLog.create({
      data: {
        feature: event.feature,
        entityId: event.entityId,
        action: event.action,
        actorType: event.actorType,
        actorId: event.actorId,
        changed: (event.changed ?? undefined) as Prisma.InputJsonValue | undefined,
        importLogId: event.importLogId,
      },
    });
  }

  /** One thin row per touched entity. `changed` is null by design — see the spec's Imports note. */
  async recordImportRows(
    importLogId: string,
    feature: AuditFeature,
    rows: readonly { entityId: string; action: AuditAction }[],
    actorId: string | null,
  ): Promise<void> {
    if (rows.length === 0) return;

    await this.prisma.rowActionLog.createMany({
      data: rows.map((row) => ({
        feature,
        entityId: row.entityId,
        action: row.action,
        actorType: AUDIT_ACTOR_TYPE.ADMIN,
        actorId,
        changed: undefined,
        importLogId,
      })),
    });
  }

  /** A normal admin's `actorId` filter is overwritten with their own id — never trusted from the query. */
  async listRowActions(
    query: RowActionListQuery,
    viewer: AuditViewer,
  ): Promise<Paginated<RowAction>> {
    this.assertActive(viewer);
    const range = dateRange(query.from, query.to);
    const where: Prisma.RowActionLogWhereInput = {
      ...(query.feature ? { feature: { in: query.feature } } : {}),
      ...(query.action ? { action: { in: query.action } } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: { in: query.actorId } } : {}),
      ...(range ? { createdAt: range } : {}),
    };
    if (!viewer.isSuperAdmin) where.actorId = viewer.id;

    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.rowActionLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: query.pageSize,
      }),
      this.prisma.rowActionLog.count({ where }),
    ]);

    const names = await this.namesFor(rows);

    return {
      items: rows.map((row) => this.toRowAction(row, names)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** Same scoping rule as `listRowActions` — imports are always admin-initiated, so only `admin` resolves. */
  async listImports(
    query: PaginationQuery,
    viewer: AuditViewer,
  ): Promise<Paginated<ImportLogSummary>> {
    this.assertActive(viewer);
    const where: Prisma.ImportLogWhereInput = {};
    if (!viewer.isSuperAdmin) where.actorId = viewer.id;

    const skip = (query.page - 1) * query.pageSize;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.importLog.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        skip,
        take: query.pageSize,
      }),
      this.prisma.importLog.count({ where }),
    ]);

    const names = await this.namesFor(
      rows.map((row) => ({ actorId: row.actorId, actorType: AUDIT_ACTOR_TYPE.ADMIN })),
    );

    return {
      items: rows.map((row) => this.toImportSummary(row, names)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** Scoped like `listImports`: an admin who cannot see the run cannot fetch what it was fed. */
  async importFile(id: string, viewer: AuditViewer): Promise<{ body: Buffer; filename: string }> {
    this.assertActive(viewer);
    const where: Prisma.ImportLogWhereInput = { id };
    if (!viewer.isSuperAdmin) where.actorId = viewer.id;

    const log = await this.prisma.importLog.findFirst({ where });
    if (!log?.fileS3Key) {
      throw new AppException(ErrorCodes.NOT_FOUND, 'That import run has no file to download');
    }

    // The extension comes off the stored key, so the name always matches the bytes.
    const extension = log.fileS3Key.split('.').pop() ?? 'xlsx';
    return {
      body: await this.storage.read(log.fileS3Key),
      filename: `${log.feature.toLowerCase()}-import-${log.id}.${extension}`,
    };
  }

  private toRowAction(row: RowActionLog, names: Map<string, string>): RowAction {
    return {
      id: row.id,
      feature: row.feature,
      entityId: row.entityId,
      action: row.action,
      actorType: row.actorType,
      actorId: row.actorId,
      actorName: row.actorId ? (names.get(row.actorId) ?? null) : null,
      changed: row.changed as RowAction['changed'],
      importLogId: row.importLogId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toImportSummary(row: ImportLog, names: Map<string, string>): ImportLogSummary {
    return {
      id: row.id,
      feature: row.feature,
      source: row.source,
      actorId: row.actorId,
      actorName: row.actorId ? (names.get(row.actorId) ?? null) : null,
      total: row.total,
      created: row.created,
      updated: row.updated,
      skipped: row.skipped,
      failed: row.failed,
      // The column is a plain string; IMPORT_LOG_STATUS is the only vocabulary written to it.
      status: row.status as ImportLogStatus,
      hasFile: row.fileS3Key !== null,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    };
  }

  /** One `findMany` per identity table per page — never one lookup per row. */
  async namesFor(
    rows: readonly { actorId: string | null; actorType: string }[],
  ): Promise<Map<string, string>> {
    const adminIds = rows
      .filter((row) => row.actorType === AUDIT_ACTOR_TYPE.ADMIN && row.actorId)
      .map((row) => row.actorId as string);
    const studentIds = rows
      .filter((row) => row.actorType === AUDIT_ACTOR_TYPE.STUDENT && row.actorId)
      .map((row) => row.actorId as string);

    const [admins, students] = await this.prisma.$transaction([
      this.prisma.admin.findMany({
        where: { id: { in: adminIds } },
        select: { id: true, fullName: true, email: true },
      }),
      this.prisma.student.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, fullName: true, mobile: true },
      }),
    ]);

    const names = new Map<string, string>();
    // Admin rows are never deleted, so `fullName` resolves; `email` only backstops a blank name.
    for (const admin of admins) names.set(admin.id, admin.fullName ?? admin.email);
    for (const student of students) names.set(student.id, student.fullName ?? student.mobile);
    return names;
  }

  /** Signed in but switched off may read nothing here — same rule `FeaturePermissionGuard` enforces. */
  private assertActive(viewer: AuditViewer): void {
    if (viewer.isActive) return;
    throw new AppException(
      ErrorCodes.FORBIDDEN,
      'Your account has been deactivated — ask a super admin to restore it',
    );
  }
}
