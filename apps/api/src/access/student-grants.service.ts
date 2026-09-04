import { Injectable } from '@nestjs/common';
import {
  AppException,
  ErrorCodes,
  type ExamCourse,
  type GrantSeriesBody,
  STUDENT_SERIES_SOURCE,
  type StudentGrantRow,
  type StudentSeriesAccess,
  type StudentSeriesSource,
  TEST_SERIES_KIND,
  type TestSeriesKind,
} from '@iace/contracts';
import { branchScopeWhere, type BranchScope } from '../common/security';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContext } from '../audit';
import { DomainEventBus, DOMAIN_EVENTS } from '../common/events';
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

export const BLOCKED_GRANT_MESSAGE =
  'That student is blocked from tests. Lift the block before granting them a series.';

/** Owns `StudentGrant`: the escape hatch, one row per (student, series), granted deliberately. */
@Injectable()
export class StudentGrantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditContext: AuditContext,
    private readonly events: DomainEventBus,
  ) {}

  async list(studentId: string, scope: BranchScope): Promise<StudentGrantRow[]> {
    await this.requireStudent(studentId, scope);

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

  /** Every series this student reaches and what opens each, read the way the resolver reads it. */
  async reachedSeries(studentId: string, scope: BranchScope): Promise<StudentSeriesAccess[]> {
    const reachable = branchScopeWhere(scope);
    const student = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        deletedAt: null,
        ...(reachable ? { currentBranchId: reachable } : {}),
      },
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
    scope: BranchScope,
  ): Promise<StudentGrantRow[]> {
    const student = await this.requireStudent(studentId, scope);
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
    const held = await this.prisma.studentGrant.findUnique({
      where: { studentId_testSeriesId: key },
      select: { testSeriesId: true },
    });

    // Granting twice is not an error: the roster it came from is often re-read.
    await this.prisma.studentGrant.upsert({
      where: { studentId_testSeriesId: key },
      create: { ...key, createdById },
      update: {},
    });

    // A grant has no row of its own to name — it is filed against the student it was made about.
    this.auditContext.setEntityId(studentId);
    this.events.emit(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED, { studentId });
    // Only what the grant CHANGED is announced: re-reading a roster must not ring the bell again.
    if (!held) this.events.emit(DOMAIN_EVENTS.SERIES_GRANTED, key);

    return this.list(studentId, scope);
  }

  async revoke(studentId: string, testSeriesId: string, scope: BranchScope): Promise<void> {
    await this.requireStudent(studentId, scope);

    await this.prisma.studentGrant.deleteMany({ where: { studentId, testSeriesId } });

    this.auditContext.setEntityId(studentId);
    this.events.emit(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED, { studentId });
  }

  /** Scoped, so a student at another branch is missing rather than merely unmodifiable. */
  private async requireStudent(
    id: string,
    scope: BranchScope,
  ): Promise<{ isTestBlocked: boolean }> {
    const reachable = branchScopeWhere(scope);
    const student = await this.prisma.student.findFirst({
      where: { id, ...(reachable ? { currentBranchId: reachable } : {}) },
      select: { isTestBlocked: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');
    return student;
  }
}
