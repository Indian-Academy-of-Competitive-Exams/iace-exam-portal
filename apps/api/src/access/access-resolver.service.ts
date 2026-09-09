import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  AppException,
  type AttemptStatus,
  ErrorCodes,
  type ExamCourse,
  type StudentCatalog,
  type StudentCatalogSeries,
  type StudentCatalogTest,
  TEST_SERIES_KIND,
  TEST_STATUS,
  type TestSeriesKind,
  testIsOpen,
  scopedSections,
  scopedDurationSec,
  type TestScopeRef,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { redisKeys } from '../redis/redis.keys';

/** A sitting that counts as done — for the series that unlocks in order, and for the test list. */
const FINISHED = new Set<AttemptStatus>([ATTEMPT_STATUS.SUBMITTED, ATTEMPT_STATUS.EVALUATED]);

/** A safety net under the event-driven busts, never the mechanism that keeps the catalog right. */
const CATALOG_TTL_SEC = 15 * 60;

/**
 * Bump on every change to `ResolvedCatalog`: the epochs survive a deploy, so without this a
 * payload the previous build wrote is read back as the new shape until its TTL runs out.
 */
const CATALOG_SHAPE = 'v10';

const catalogInclude = (programs: string[]) =>
  ({
    examStage: { select: { id: true, name: true, exam: { select: { code: true, course: true } } } },
    tests: {
      where: { status: TEST_STATUS.ACTIVE },
      select: {
        id: true,
        title: true,
        seriesOrder: true,
        opensAt: true,
        scope: true,
        scopeRef: true,
        baseConfig: {
          select: {
            durationSec: true,
            totalQuestions: true,
            totalMarks: true,
            // A scoped test is its own sections' worth, and the catalog is what a student reads first.
            sections: {
              select: {
                id: true,
                moduleId: true,
                questionCount: true,
                marksPerQuestion: true,
                durationSec: true,
                perQuestionSec: true,
              },
            },
          },
        },
        // No program, no row, which is already what "no row" means: the test's own opening.
        programUnlocks: { where: { programCode: { in: programs } }, select: { opensAt: true } },
      },
    },
  }) as const satisfies Prisma.TestSeriesInclude;

type CatalogRow = Prisma.TestSeriesGetPayload<{ include: ReturnType<typeof catalogInclude> }>;

interface ResolvedTest {
  id: string;
  title: string | null;
  /** What the paper IS, not what this student may do with it — static, so it caches safely. */
  durationSec: number;
  totalQuestions: number;
  totalMarks: number;
  order: number | null;
  /** The opening, resolved once. `canStart` is derived from the CLOCK on every read, never cached. */
  opensAt: string | null;
  /** Where this student got to. Cached, and busted when a sitting starts or ends. */
  attemptStatus: AttemptStatus | null;
}

/** What is cached: everything the clock does NOT decide. */
interface ResolvedSeries {
  id: string;
  name: string;
  description: string | null;
  examStage: { id: string; name: string; examCode: string; course: ExamCourse } | null;
  programCode: string | null;
  kind: TestSeriesKind;
  sequentialTests: boolean;
  tests: ResolvedTest[];
}

interface ResolvedCatalog {
  testBlocked: boolean;
  series: ResolvedSeries[];
}

/** The one place "can this student reach this?" is answered: by the series' kind, or by a grant. */
@Injectable()
export class AccessResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** The catalog as of `now` — availability and `canStart` are derived here on every read. */
  async catalog(studentId: string, now: Date = new Date()): Promise<StudentCatalog> {
    const resolved = await this.resolved(studentId);

    return {
      testBlocked: resolved.testBlocked,
      series: resolved.series.map((series) => project(series, resolved.testBlocked, now)),
    };
  }

  /** Cached WITH the catalog, not read per request: starting and submitting are what bust it. */
  private async sittings(studentId: string): Promise<ReadonlyMap<string, AttemptStatus>> {
    const attempts = await this.prisma.attempt.findMany({
      where: { studentId },
      select: { testId: true, status: true },
      orderBy: { attemptNo: 'asc' },
    });
    // They arrive in attempt order and the last write wins, so the latest sitting is what shows.
    return new Map(attempts.map((row) => [row.testId, row.status]));
  }

  /**
   * The attempt-start guard: the catalog's own resolution, so the two cannot disagree, plus a
   * live re-read of the switches the cache cannot be trusted to have caught up with.
   */
  async assertCanStart(studentId: string, testId: string, now: Date = new Date()): Promise<void> {
    const [permitted, { series }] = await Promise.all([
      this.stillPermitted(studentId),
      this.catalog(studentId, now),
    ]);

    const test = permitted
      ? series.flatMap((row) => row.tests).find((row) => row.id === testId)
      : undefined;
    if (test?.canStart) return;

    throw new AppException(ErrorCodes.FORBIDDEN, refusalFor(test, now));
  }

  /** Reachable is not startable: a test they cannot sit YET is still one they may read about. */
  async assertReachable(studentId: string, testId: string): Promise<void> {
    const resolved = await this.resolved(studentId);
    const reaches = resolved.series.some((series) =>
      series.tests.some((test) => test.id === testId),
    );
    if (!reaches) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');
  }

  /** Everyone one series reaches, which is the catalog read backwards. Ids only: the caller fans out. */
  async studentsReaching(testSeriesId: string): Promise<string[]> {
    const series = await this.prisma.testSeries.findUnique({
      where: { id: testSeriesId },
      select: AUDIENCE_SELECT,
    });
    if (series === null || !series.isEnabled) return [];

    const students = await this.prisma.student.findMany({
      where: audienceOf(series),
      select: { id: true },
    });
    return students.map((student) => student.id);
  }

  async invalidateStudent(studentId: string): Promise<void> {
    await this.redis.client.incr(redisKeys.catalogStudentEpoch(studentId));
  }

  async invalidateAll(): Promise<void> {
    await this.redis.client.incr(redisKeys.catalogEpoch);
  }

  /**
   * A block or a deactivation must bite now, not when the entry expires — the cache bust is
   * best-effort, and this is an authorization answer, not the live-test hot path.
   */
  private async stillPermitted(studentId: string): Promise<boolean> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { isActive: true, isTestBlocked: true, deletedAt: true },
    });
    return student?.isActive === true && !student.isTestBlocked && student.deletedAt === null;
  }

  private async resolved(studentId: string): Promise<ResolvedCatalog> {
    const key = await this.catalogKey(studentId);

    const cached = await this.redis.getJson<ResolvedCatalog>(key);
    if (cached) return cached;

    const catalog = await this.resolve(studentId);
    await this.redis.setJson(key, catalog, CATALOG_TTL_SEC);
    return catalog;
  }

  private async catalogKey(studentId: string): Promise<string> {
    const [epoch, studentEpoch] = await this.redis.client.mget(
      redisKeys.catalogEpoch,
      redisKeys.catalogStudentEpoch(studentId),
    );
    return redisKeys.studentCatalog(
      studentId,
      CATALOG_SHAPE,
      counterOf(epoch),
      counterOf(studentEpoch),
    );
  }

  private async resolve(studentId: string): Promise<ResolvedCatalog> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null, isActive: true },
      select: {
        isTestBlocked: true,
        currentBranchId: true,
        programs: true,
        enrolledCourses: true,
      },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    const rows = await this.prisma.testSeries.findMany({
      where: reachableBy(studentId, student),
      include: catalogInclude(student.programs),
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    const sittings = await this.sittings(studentId);

    return {
      testBlocked: student.isTestBlocked,
      series: rows.map((row) => toResolved(row, sittings)),
    };
  }
}

/** A corrupt counter would otherwise make the key NaN — stable, so every later bust is a no-op. */
function counterOf(raw: string | null | undefined): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** One where-input for reach, asked by all three readers; a grant overrides every kind but the switch. */
export function reachableBy(
  studentId: string,
  student: Readonly<{
    currentBranchId: string | null;
    programs: string[];
    enrolledCourses: ExamCourse[];
  }>,
): Prisma.TestSeriesWhereInput {
  const automatic: Prisma.TestSeriesWhereInput[] = [
    { kind: TEST_SERIES_KIND.FREE },
    ...(student.currentBranchId !== null && student.enrolledCourses.length > 0
      ? [
          {
            kind: TEST_SERIES_KIND.STANDARD,
            branchIds: { has: student.currentBranchId },
            examStage: { exam: { course: { in: student.enrolledCourses } } },
          },
        ]
      : []),
    ...(student.programs.length > 0
      ? [{ kind: TEST_SERIES_KIND.PROGRAM, programCode: { in: student.programs } }]
      : []),
    { kind: TEST_SERIES_KIND.EVENT, event: { candidates: { some: { studentId } } } },
  ];

  return { isEnabled: true, OR: [{ grants: { some: { studentId } } }, ...automatic] };
}

/** What a series reaches, as a STUDENT filter. The mirror of `reachableBy`; edit the two together. */
function audienceOf(
  series: Readonly<{
    id: string;
    kind: TestSeriesKind;
    programCode: string | null;
    branchIds: string[];
    eventId: string | null;
    examStage: { exam: { course: ExamCourse } } | null;
  }>,
): Prisma.StudentWhereInput {
  return {
    deletedAt: null,
    isActive: true,
    // A grant overrides every kind, exactly as it does reading the other way.
    OR: [{ grants: { some: { testSeriesId: series.id } } }, ...automaticAudience(series)],
  };
}

function automaticAudience(series: Parameters<typeof audienceOf>[0]): Prisma.StudentWhereInput[] {
  if (series.kind === TEST_SERIES_KIND.FREE) return [{}];
  if (series.kind === TEST_SERIES_KIND.EVENT) {
    return series.eventId === null
      ? []
      : [{ eventCandidacies: { some: { eventId: series.eventId } } }];
  }
  if (series.kind === TEST_SERIES_KIND.PROGRAM) {
    return series.programCode === null ? [] : [{ programs: { has: series.programCode } }];
  }
  // STANDARD: the branches it runs in, narrowed to who is enrolled on the stage's course.
  const course = series.examStage?.exam.course;
  if (series.branchIds.length === 0 || course === undefined) return [];

  return [{ currentBranchId: { in: series.branchIds }, enrolledCourses: { has: course } }];
}

const AUDIENCE_SELECT = {
  id: true,
  isEnabled: true,
  kind: true,
  programCode: true,
  branchIds: true,
  eventId: true,
  examStage: { select: { exam: { select: { course: true } } } },
} as const;

function toResolved(row: CatalogRow, sittings: ReadonlyMap<string, AttemptStatus>): ResolvedSeries {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    examStage: row.examStage
      ? {
          id: row.examStage.id,
          name: row.examStage.name,
          examCode: row.examStage.exam.code,
          course: row.examStage.exam.course,
        }
      : null,
    programCode: row.programCode,
    kind: row.kind,
    sequentialTests: row.sequentialTests,
    tests: row.tests.map((test) => toResolvedTest(test, sittings)).sort(byOrderThenId),
  };
}

/** Earliest, because a student in two programs is not held back by the slower one. */
function opensFor(test: {
  opensAt: Date | null;
  programUnlocks: readonly { opensAt: Date }[];
}): Date | null {
  const earliest = test.programUnlocks.reduce<Date | null>(
    (best, row) => (best === null || row.opensAt < best ? row.opensAt : best),
    null,
  );
  return earliest ?? test.opensAt;
}

function toResolvedTest(
  test: CatalogRow['tests'][number],
  sittings: ReadonlyMap<string, AttemptStatus>,
): ResolvedTest {
  const scoped = scopedSections(
    test.baseConfig.sections,
    test.scope,
    (test.scopeRef as TestScopeRef | null) ?? null,
  );

  return {
    id: test.id,
    title: test.title,
    durationSec: scopedDurationSec(
      test.baseConfig.sections,
      test.baseConfig,
      test.scope,
      (test.scopeRef as TestScopeRef | null) ?? null,
    ),
    totalQuestions: scoped.reduce((total, section) => total + section.questionCount, 0),
    totalMarks: scoped.reduce(
      (total, section) => total + section.questionCount * Number(section.marksPerQuestion),
      0,
    ),
    order: test.seriesOrder,
    opensAt: opensFor(test)?.toISOString() ?? null,
    attemptStatus: sittings.get(test.id) ?? null,
  };
}

const isFinished = (status: AttemptStatus | null): boolean =>
  status !== null && FINISHED.has(status);

function project(series: ResolvedSeries, testBlocked: boolean, now: Date): StudentCatalogSeries {
  // In order means: the first one not yet sat is open, and everything past it waits its turn.
  const waiting = series.sequentialTests
    ? series.tests.findIndex((test) => !isFinished(test.attemptStatus))
    : NONE_WAITING;

  return {
    ...series,
    tests: series.tests.map((test, index) =>
      projectTest(test, !testBlocked && (waiting === NONE_WAITING || index <= waiting), now),
    ),
  };
}

/** `findIndex` returns -1 when every test is sat, which is also "nothing is waiting its turn". */
const NONE_WAITING = -1;

/** The clock is read HERE and never cached, so a test opens on time without anything busting a key. */
function projectTest(test: ResolvedTest, reachable: boolean, now: Date): StudentCatalogTest {
  // A sat test stays startable: a paper may always be sat again, and Done is only where it sorts.
  return { ...test, canStart: reachable && testIsOpen(test.opensAt, now), sittingCount: null };
}

/** Why a sitting may not begin: not open YET is a different fact from having no access at all. */
function refusalFor(test: StudentCatalogTest | undefined, now: Date): string {
  if (test && !testIsOpen(test.opensAt, now)) return 'This test has not opened yet';

  return 'This test is not open to you right now';
}

/** An unordered test sorts last, and the id keeps the order stable when two share one. */
const ORDERED_LAST = Number.MAX_SAFE_INTEGER;

function byOrderThenId(left: ResolvedTest, right: ResolvedTest): number {
  return (
    (left.order ?? ORDERED_LAST) - (right.order ?? ORDERED_LAST) || left.id.localeCompare(right.id)
  );
}
