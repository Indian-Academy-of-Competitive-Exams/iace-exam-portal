import { Injectable } from '@nestjs/common';
import {
  AUDIT_ACTOR_TYPE,
  AppException,
  ErrorCodes,
  type ExamCourse,
  NOTIFICATION_TYPE,
  type GrantSeriesBody,
  STUDENT_SERIES_SOURCE,
  type StudentGrantRow,
  type StudentSeriesAccess,
  type StudentSeriesSource,
  TEST_SERIES_KIND,
  type TestSeriesKind,
} from '@iace/contracts';
import { PrismaService, TX_LIMITS } from '../prisma/prisma.service';
import { AuditContext, AuditService } from '../audit';
import {
  EXPORT_DATE_FORMATS,
  assertExportable,
  exportInstant,
  readInBatches,
  writeWorkbook,
  type ExportColumn,
} from '../common/exporting';
import { studentCardsOf, type StudentCard } from '../students';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
import { NotificationOutbox } from '../notifications';
import { reachableBy } from './access-resolver.service';

/** What a series reaches by, and what a student carries, as `reachableBy` weighs the two. */
interface ReachPairing {
  series: Readonly<{
    kind: TestSeriesKind;
    programCode: string | null;
    course: ExamCourse | null;
    branchIds: readonly string[];
    granted: boolean;
    isCandidate: boolean;
  }>;
  student: Readonly<{
    currentBranchId: string | null;
    programs: readonly string[];
    enrolledCourses: readonly ExamCourse[];
  }>;
}

/** Mirrors `reachableBy` arm for arm: a kind decides the automatic route, and a grant adds one. */
export function seriesSources({ series, student }: ReachPairing): StudentSeriesSource[] {
  const automatic: Partial<Record<TestSeriesKind, boolean>> = {
    [TEST_SERIES_KIND.FREE]: true,
    [TEST_SERIES_KIND.STANDARD]:
      student.currentBranchId !== null &&
      series.branchIds.includes(student.currentBranchId) &&
      series.course !== null &&
      student.enrolledCourses.includes(series.course),
    [TEST_SERIES_KIND.PROGRAM]:
      series.programCode !== null && student.programs.includes(series.programCode),
    [TEST_SERIES_KIND.EVENT]: series.isCandidate,
  };

  return [
    ...(automatic[series.kind] ? [SOURCE_OF_KIND[series.kind]] : []),
    ...(series.granted ? [STUDENT_SERIES_SOURCE.GRANT] : []),
  ];
}

/** The source a kind is reached by when its own arm matches. A grant is not a kind, so it is not here. */
const SOURCE_OF_KIND: Readonly<Record<TestSeriesKind, StudentSeriesSource>> = {
  [TEST_SERIES_KIND.STANDARD]: STUDENT_SERIES_SOURCE.COURSE,
  [TEST_SERIES_KIND.FREE]: STUDENT_SERIES_SOURCE.FREE,
  [TEST_SERIES_KIND.PROGRAM]: STUDENT_SERIES_SOURCE.PROGRAM,
  [TEST_SERIES_KIND.EVENT]: STUDENT_SERIES_SOURCE.EVENT,
};

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

export const BLOCKED_GRANT_MESSAGE =
  'That student is blocked from tests. Lift the block before granting them a series.';

/** Owns `StudentGrant`: the escape hatch, one row per (student, series), granted deliberately. */
@Injectable()
export class StudentGrantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext: AuditContext,
    private readonly events: DomainEventBus,
    private readonly notifications: NotificationOutbox,
    private readonly audit: AuditService,
  ) {}

  async list(studentId: string): Promise<StudentGrantRow[]> {
    await this.requireStudent(studentId);

    const rows = await this.prisma.studentGrant.findMany({
      where: { studentId },
      include: { testSeries: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }],
    });

    return rows.map((row) => ({
      studentId: row.studentId,
      testSeriesId: row.testSeriesId,
      testSeries: row.testSeries,
      createdAt: row.createdAt.toISOString(),
    }));
  }

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
      readInBatches(
        grants.map((grant) => grant.studentId),
        (ids) => studentCardsOf(this.prisma, ids),
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

  /** Every series this student reaches and what opens each, read the way the resolver reads it. */
  async reachedSeries(studentId: string): Promise<StudentSeriesAccess[]> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: {
        currentBranchId: true,
        programs: true,
        enrolledCourses: true,
      },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    const rows = await this.prisma.testSeries.findMany({
      where: reachableBy(studentId, student),
      select: {
        id: true,
        name: true,
        kind: true,
        programCode: true,
        branchIds: true,
        examStage: { select: { exam: { select: { course: true } } } },
        grants: { where: { studentId }, select: { createdAt: true } },
        event: { select: { candidates: { where: { studentId }, select: { studentId: true } } } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sources: seriesSources({
        series: {
          kind: row.kind,
          programCode: row.programCode,
          course: row.examStage?.exam.course ?? null,
          branchIds: row.branchIds,
          granted: row.grants.length > 0,
          isCandidate: (row.event?.candidates.length ?? 0) > 0,
        },
        student,
      }),
      grantedAt: row.grants[0]?.createdAt.toISOString() ?? null,
    }));
  }

  async grant(
    studentId: string,
    input: GrantSeriesBody,
    createdById: string,
  ): Promise<StudentGrantRow[]> {
    const student = await this.requireStudent(studentId);
    if (student.isTestBlocked) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, BLOCKED_GRANT_MESSAGE, {
        fieldErrors: { testSeriesId: [BLOCKED_GRANT_MESSAGE] },
      });
    }

    const series = await this.prisma.testSeries.findUnique({
      where: { id: input.testSeriesId },
      select: { id: true },
    });
    if (!series) {
      const message = 'No such series';
      throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
        fieldErrors: { testSeriesId: [message] },
      });
    }

    const key = { studentId, testSeriesId: input.testSeriesId };
    // One transaction, so the read that decides "is this new" cannot lose a race with a second grant.
    await this.prisma.$transaction(async (tx) => {
      const already = await tx.studentGrant.findUnique({
        where: { studentId_testSeriesId: key },
        select: { testSeriesId: true },
      });

      // Granting twice is not an error: the roster it came from is often re-read.
      await tx.studentGrant.upsert({
        where: { studentId_testSeriesId: key },
        create: { ...key, createdById },
        update: {},
      });

      // Only what the grant CHANGED is told: re-reading a roster must not ring the bell again.
      if (!already) {
        await this.notifications.request(tx, {
          studentId,
          type: NOTIFICATION_TYPE.GRANT_ADDED,
          title: 'A test series was added to your account',
          body: 'Your institute has given you access to it.',
          dedupeKey: `grant:${input.testSeriesId}`,
          testSeriesId: input.testSeriesId,
        });
      }
    }, TX_LIMITS.SHORT);

    // A grant has no row of its own to name — it is filed against the student it was made about.
    this.auditContext.setEntityId(studentId);
    this.events.emit(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED, { studentId });

    return this.list(studentId);
  }

  async revoke(studentId: string, testSeriesId: string): Promise<void> {
    await this.requireStudent(studentId);

    await this.prisma.studentGrant.deleteMany({ where: { studentId, testSeriesId } });

    this.auditContext.setEntityId(studentId);
    this.events.emit(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED, { studentId });
  }

  private async requireStudent(id: string): Promise<{ isTestBlocked: boolean }> {
    const student = await this.prisma.student.findFirst({
      where: { id },
      select: { isTestBlocked: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');
    return student;
  }
}
