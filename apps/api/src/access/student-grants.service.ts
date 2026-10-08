import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTOR_TYPE,
  AppException,
  ErrorCodes,
  NOTIFICATION_TYPE,
  type GrantSeriesBody,
  type StudentSeriesAccess,
} from '@iace/contracts';
import { PrismaService, TX_LIMITS } from '../prisma/prisma.service';
import { AuditContext, AuditService } from '../audit';
import {
  EXPORT_DATE_FORMATS,
  assertExportable,
  exportInstant,
  writeWorkbook,
  type ExportColumn,
} from '../common/exporting';
import { studentCardsOf, type StudentCard } from '../students';
import { NotificationsService } from '../notifications';
import { AccessResolverService } from './access-resolver.service';

interface GrantRow {
  student: StudentCard;
  grantedAt: Date;
  grantedBy: string | null;
}

const GRANT_COLUMNS: ExportColumn<GrantRow>[] = [
  { header: 'Student', width: 28, value: (row) => row.student.fullName },
  { header: 'Mobile', width: 14, text: true, value: (row) => row.student.mobile },
  { header: 'Branch', width: 20, value: (row) => row.student.currentBranch?.name ?? null },
  {
    header: 'Granted at',
    width: 18,
    date: EXPORT_DATE_FORMATS.INSTANT,
    value: (row) => exportInstant(row.grantedAt),
  },
  { header: 'Granted by', width: 28, value: (row) => row.grantedBy },
];

/** What a grant or a revoke files against the student: the series it gave or took, by name. */
const SERIES_FIELD = 'series';

export const BLOCKED_GRANT_MESSAGE =
  'That student is blocked from tests. Lift the block before granting them a series.';

/** Owns `StudentGrant`: the escape hatch, one row per (student, series), granted deliberately. */
@Injectable()
export class StudentGrantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext: AuditContext,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly access: AccessResolverService,
  ) {}

  async exportForSeries(testSeriesId: string): Promise<{ workbook: Buffer; rows: number }> {
    const series = await this.prisma.testSeries.findUnique({
      where: { id: testSeriesId },
      select: { id: true },
    });
    if (!series) throw new AppException(ErrorCodes.NOT_FOUND, 'No such series');

    assertExportable(await this.prisma.studentGrant.count({ where: { testSeriesId } }));
    const grants = await this.prisma.studentGrant.findMany({
      where: { testSeriesId },
      select: { studentId: true, createdAt: true, createdById: true },
      orderBy: [{ createdAt: 'desc' }, { studentId: 'asc' }],
    });

    const [cards, names] = await Promise.all([
      studentCardsOf(
        this.prisma,
        grants.map((grant) => grant.studentId),
      ),
      this.audit.namesFor(
        grants.map((grant) => ({ actorId: grant.createdById, actorType: AUDIT_ACTOR_TYPE.ADMIN })),
      ),
    ]);
    const byId = new Map(cards.map((card) => [card.id, card]));
    const rows = grants.flatMap((grant) => {
      const student = byId.get(grant.studentId);
      if (!student) return [];
      const grantedBy = grant.createdById ? (names.get(grant.createdById) ?? null) : null;
      return [{ student, grantedAt: grant.createdAt, grantedBy }];
    });

    const workbook = await writeWorkbook([{ name: 'Grants', columns: GRANT_COLUMNS, rows }]);
    return { workbook, rows: rows.length };
  }

  /** Every series this student reaches and what opens each: the resolver's own reach, and when each grant was made. */
  async reachedSeries(studentId: string): Promise<StudentSeriesAccess[]> {
    const [reached, grants] = await Promise.all([
      this.access.seriesReachedBy(studentId),
      this.prisma.studentGrant.findMany({
        where: { studentId },
        select: { testSeriesId: true, createdAt: true },
      }),
    ]);
    if (!reached) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    const grantedAt = new Map(grants.map((grant) => [grant.testSeriesId, grant.createdAt]));
    return reached.map((row) => ({
      ...row,
      grantedAt: grantedAt.get(row.id)?.toISOString() ?? null,
    }));
  }

  async grant(studentId: string, input: GrantSeriesBody, createdById: string): Promise<void> {
    const student = await this.requireStudent(studentId);
    if (student.isTestBlocked) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, BLOCKED_GRANT_MESSAGE, {
        fieldErrors: { testSeriesId: [BLOCKED_GRANT_MESSAGE] },
      });
    }

    const series = await this.prisma.testSeries.findUnique({
      where: { id: input.testSeriesId },
      select: { name: true },
    });
    if (!series) {
      const message = 'No such series';
      throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
        fieldErrors: { testSeriesId: [message] },
      });
    }

    const granted = await this.prisma.$transaction(async (tx) => {
      // Granting twice is not an error, and the insert itself says whether this one was new: two landing together write one row.
      const [made] = await tx.studentGrant.createManyAndReturn({
        data: [{ studentId, testSeriesId: input.testSeriesId, createdById }],
        skipDuplicates: true,
        select: { createdAt: true },
      });
      if (!made) return false;

      // Only what the grant CHANGED is told: re-reading a roster must not ring the bell again.
      await this.notifications.tell(tx, {
        studentId,
        type: NOTIFICATION_TYPE.GRANT_ADDED,
        title: 'A test series was added to your account',
        body: 'Your institute has given you access to it.',
        // Named for this grant row, not the series: one taken back and granted again is news again.
        dedupeKey: `grant:${input.testSeriesId}:${made.createdAt.toISOString()}`,
        testSeriesId: input.testSeriesId,
      });
      return true;
    }, TX_LIMITS.SHORT);

    // A grant has no row of its own to name — it is filed against the student it was made about.
    this.auditContext.setEntityId(studentId);
    if (granted) this.auditContext.setChanged({ [SERIES_FIELD]: { from: null, to: series.name } });
  }

  async revoke(studentId: string, testSeriesId: string): Promise<void> {
    await this.requireStudent(studentId);

    const taken = await this.prisma.studentGrant.deleteMany({ where: { studentId, testSeriesId } });

    this.auditContext.setEntityId(studentId);
    if (taken.count === 0) return;
    const series = await this.prisma.testSeries.findUnique({
      where: { id: testSeriesId },
      select: { name: true },
    });
    this.auditContext.setChanged({ [SERIES_FIELD]: { from: series?.name ?? null, to: null } });
  }

  /** Live only: an erased student's tombstone is granted nothing and has nothing taken back. */
  private async requireStudent(id: string): Promise<{ isTestBlocked: boolean }> {
    const student = await this.prisma.student.findFirst({
      where: { id, deletedAt: null },
      select: { isTestBlocked: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');
    return student;
  }
}
