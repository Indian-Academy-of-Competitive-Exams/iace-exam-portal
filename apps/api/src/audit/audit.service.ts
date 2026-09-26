import { Injectable } from '@nestjs/common';
import { type ImportLog, type Prisma, type RowActionLog } from '@prisma/client';
import {
  AUDIT_ACTOR_TYPE,
  AppException,
  ErrorCodes,
  dateOnlySchema,
  type AuditAction,
  type AuditActorType,
  type AuditFeature,
  type FieldDiff,
  type ImportLogStatus,
  type ImportLogSummary,
  type Paginated,
  type PaginationQuery,
  type RowAction,
  type RowActionExportQuery,
  type RowActionListQuery,
} from '@iace/contracts';
import { endOfInstituteDay, startOfInstituteDay } from '../common/time/institute-day';
import {
  EXPORT_DATE_FORMATS,
  assertExportable,
  exportInstant,
  readInBatches,
  writeWorkbook,
  type ExportColumn,
} from '../common/exporting';
import { matchFilters } from '../common/match-filters';
import { pageArgs, paged } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/** One audited write, as the interceptor saw it succeed. */
export interface AuditEntry {
  feature: AuditFeature;
  action: AuditAction;
  entityId: string;
  actorType: AuditActorType;
  actorId: string | null;
  changed: FieldDiff | null;
}

/** Enough of the authenticated caller to scope a read — never the whole `AuthenticatedUser`. */
export interface AuditViewer {
  id: string;
  isSuperAdmin: boolean;
  isActive: boolean;
}

/** A calendar-day bound. `rowActionListQuerySchema` already rejects anything else; this is what keeps a direct caller from reaching Prisma with an Invalid Date. */
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

const ROW_ACTION_ORDER: Prisma.RowActionLogOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];

/** A normal admin's `actorId` filter is overwritten with their own id — never trusted from the query. */
export function rowActionWhere(
  query: RowActionExportQuery,
  viewer: AuditViewer,
): Prisma.RowActionLogWhereInput {
  const range = dateRange(query.from, query.to);
  const chosen: Prisma.RowActionLogWhereInput[] = [
    ...(query.feature ? [{ feature: { in: query.feature } }] : []),
    ...(query.action ? [{ action: { in: query.action } }] : []),
    // Honoured for a super admin only: ANDing an ignored one against the pin below finds nobody.
    ...(viewer.isSuperAdmin && query.actorId ? [{ actorId: { in: query.actorId } }] : []),
  ];
  const always: Prisma.RowActionLogWhereInput[] = [
    ...(query.entityId ? [{ entityId: query.entityId }] : []),
    ...(range ? [{ createdAt: range }] : []),
  ];

  const and = matchFilters(always, chosen, query.match);
  const where: Prisma.RowActionLogWhereInput = and.length > 0 ? { AND: and } : {};
  // Outside the AND: it narrows whatever the mode built, so ANY cannot widen past the viewer.
  if (!viewer.isSuperAdmin) where.actorId = viewer.id;
  return where;
}

const ROW_ACTION_COLUMNS: ExportColumn<RowAction>[] = [
  {
    header: 'When',
    width: 18,
    date: EXPORT_DATE_FORMATS.INSTANT,
    value: (row) => exportInstant(new Date(row.createdAt)),
  },
  { header: 'Feature', width: 20, value: (row) => row.feature },
  { header: 'Action', width: 12, value: (row) => row.action },
  { header: 'Record', width: 38, text: true, value: (row) => row.entityId },
  { header: 'Actor type', width: 12, value: (row) => row.actorType },
  { header: 'Actor', width: 28, value: (row) => row.actorName },
  {
    header: 'Changed',
    width: 60,
    value: (row) => (row.changed ? JSON.stringify(row.changed) : null),
  },
];

/** Owns `RowActionLog` — the only module that writes it. */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** `changed` on a CREATE is not a snapshot: `fieldDiff` drops a field that is null on both sides. */
  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.rowActionLog.create({
      data: {
        feature: entry.feature,
        entityId: entry.entityId,
        action: entry.action,
        actorType: entry.actorType,
        actorId: entry.actorId,
        changed: (entry.changed ?? undefined) as Prisma.InputJsonValue | undefined,
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

  async listRowActions(
    query: RowActionListQuery,
    viewer: AuditViewer,
  ): Promise<Paginated<RowAction>> {
    this.assertActive(viewer);
    const where = rowActionWhere(query, viewer);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.rowActionLog.findMany({
        where,
        orderBy: ROW_ACTION_ORDER,
        ...pageArgs(query),
      }),
      this.prisma.rowActionLog.count({ where }),
    ]);

    const names = await this.namesFor(rows);

    return paged(
      query,
      rows.map((row) => this.toRowAction(row, names)),
      total,
    );
  }

  /** Every row the list would page through, in the list's order; a non-super admin gets only their own. */
  async exportRowActions(
    query: RowActionExportQuery,
    viewer: AuditViewer,
  ): Promise<{ workbook: Buffer; rows: number }> {
    this.assertActive(viewer);
    const where = rowActionWhere(query, viewer);
    assertExportable(await this.prisma.rowActionLog.count({ where }));

    const rows = await this.prisma.rowActionLog.findMany({ where, orderBy: ROW_ACTION_ORDER });
    const names = await this.namesFor(rows);
    const workbook = await writeWorkbook([
      {
        name: 'Audit log',
        columns: ROW_ACTION_COLUMNS,
        rows: rows.map((row) => this.toRowAction(row, names)),
      },
    ]);
    return { workbook, rows: rows.length };
  }

  /** Same scoping rule as `listRowActions` — imports are always admin-initiated, so only `admin` resolves. */
  async listImports(
    query: PaginationQuery,
    viewer: AuditViewer,
  ): Promise<Paginated<ImportLogSummary>> {
    this.assertActive(viewer);
    const where: Prisma.ImportLogWhereInput = {};
    if (!viewer.isSuperAdmin) where.actorId = viewer.id;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.importLog.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.importLog.count({ where }),
    ]);

    const names = await this.namesFor(
      rows.map((row) => ({ actorId: row.actorId, actorType: AUDIT_ACTOR_TYPE.ADMIN })),
    );

    return paged(
      query,
      rows.map((row) => this.toImportSummary(row, names)),
      total,
    );
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
    const idsOf = (actorType: string) => [
      ...new Set(
        rows.flatMap((row) => (row.actorType === actorType && row.actorId ? [row.actorId] : [])),
      ),
    ];

    // Sliced: an export's distinct student actors can outrun Postgres's bind limit on their own.
    const [admins, students] = await Promise.all([
      readInBatches(idsOf(AUDIT_ACTOR_TYPE.ADMIN), (ids) =>
        this.prisma.admin.findMany({
          where: { id: { in: ids } },
          select: { id: true, fullName: true, email: true },
        }),
      ),
      readInBatches(idsOf(AUDIT_ACTOR_TYPE.STUDENT), (ids) =>
        this.prisma.student.findMany({
          where: { id: { in: ids } },
          select: { id: true, fullName: true, mobile: true },
        }),
      ),
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
      'Your account has been deactivated. Ask a super admin to restore it',
    );
  }
}
