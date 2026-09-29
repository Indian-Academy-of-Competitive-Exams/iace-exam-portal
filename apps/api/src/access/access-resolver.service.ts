import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  AppException,
  type AttemptStatus,
  ErrorCodes,
  type ExamCourse,
  STUDENT_SERIES_SOURCE,
  type StudentCatalog,
  type StudentCatalogSeries,
  type StudentCatalogTest,
  type StudentSeriesSource,
  TEST_SERIES_KIND,
  TEST_STATUS,
  type TestSeriesKind,
  isSat,
  testIsOpen,
  scopedSections,
  scopedDurationSec,
  scopedQuestionCount,
  type TestScopeRef,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { redisKeys } from '../redis/redis.keys';

/** The safety net under the counter: a write that changes a held field without bumping it lasts this long at most. */
const CATALOG_MAX_AGE_MS = 15 * 60 * 1000;

/** Every enabled series and its ACTIVE tests: the same for every student, so one copy per process. */
const SHARED_SELECT = {
  id: true,
  name: true,
  kind: true,
  sequentialTests: true,
  programCode: true,
  branchIds: true,
  eventId: true,
  examStage: { select: { id: true, name: true, exam: { select: { code: true, course: true } } } },
  tests: {
    where: { status: TEST_STATUS.ACTIVE },
    select: {
      id: true,
      title: true,
      seriesOrder: true,
      opensAt: true,
      examTemplate: true,
      scope: true,
      scopeRef: true,
      programUnlocks: { select: { programCode: true, opensAt: true } },
      baseConfig: {
        select: {
          durationSec: true,
          totalQuestions: true,
          languageMode: true,
          languages: true,
          navigation: true,
          sections: {
            select: {
              id: true,
              moduleId: true,
              name: true,
              questionCount: true,
              durationSec: true,
              perQuestionSec: true,
              marksPerQuestion: true,
              negativeMarks: true,
            },
            orderBy: { order: 'asc' },
          },
        },
      },
    },
  },
} as const satisfies Prisma.TestSeriesSelect;

type SharedSeries = Prisma.TestSeriesGetPayload<{ select: typeof SHARED_SELECT }>;

/** One test as every student reaching it sees it, before their own programs and sittings are applied. */
export type ReachableTest = SharedSeries['tests'][number];

/** One series a student reaches, and every route that reaches it. */
export interface SeriesReach {
  id: string;
  name: string;
  sources: StudentSeriesSource[];
}

interface HeldCatalog {
  epoch: number;
  builtAt: number;
  series: Promise<SharedSeries[]>;
}

/** What a student reaches by, read live on every call: nothing per student is cached, so nothing per student is busted. */
const REACH_FACTS = {
  isActive: true,
  deletedAt: true,
  isTestBlocked: true,
  currentBranchId: true,
  programs: true,
  enrolledCourses: true,
  grants: { select: { testSeriesId: true } },
  eventCandidacies: { select: { eventId: true } },
} as const satisfies Prisma.StudentSelect;

const STANDING_FACTS = {
  ...REACH_FACTS,
  // A voided sitting did not happen: it must not hide the real one under it.
  attempts: {
    where: { status: { not: ATTEMPT_STATUS.VOIDED } },
    select: { testId: true, status: true },
    orderBy: { attemptNo: 'asc' },
  },
} as const satisfies Prisma.StudentSelect;

interface Reach {
  isTestBlocked: boolean;
  currentBranchId: string | null;
  programs: string[];
  enrolledCourses: ExamCourse[];
  grantedSeries: ReadonlySet<string>;
  events: ReadonlySet<string>;
}

interface Standing extends Reach {
  sittings: ReadonlyMap<string, AttemptStatus>;
}

interface ResolvedTest {
  id: string;
  title: string | null;
  durationSec: number;
  sectionCount: number;
  totalQuestions: number;
  order: number | null;
  opensAt: string | null;
  attemptStatus: AttemptStatus | null;
}

interface ResolvedSeries {
  id: string;
  name: string;
  examStage: { id: string; name: string; examCode: string; course: ExamCourse } | null;
  kind: TestSeriesKind;
  sequentialTests: boolean;
  tests: ResolvedTest[];
}

/** The one place "can this student reach this?" is answered: by the series' kind, or by a grant. */
@Injectable()
export class AccessResolverService {
  private held: HeldCatalog | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** The catalog as of `now` — availability and `canStart` are derived here on every read. */
  async catalog(studentId: string, now: Date = new Date()): Promise<StudentCatalog> {
    const [standing, series] = await Promise.all([this.standingOf(studentId), this.shared()]);
    if (!standing) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    return catalogOf(series, standing, now);
  }

  /** The attempt-start guard: the catalog's own resolution, so the two cannot disagree. */
  async assertCanStart(studentId: string, testId: string, now: Date = new Date()): Promise<void> {
    const [standing, series] = await Promise.all([this.standingOf(studentId), this.shared()]);

    // A block refuses as "not open to you", never as "not opened yet": no opening will ever let them in.
    const test =
      standing && !standing.isTestBlocked
        ? catalogOf(series, standing, now)
            .series.flatMap((row) => row.tests)
            .find((row) => row.id === testId)
        : undefined;
    if (test?.canStart) return;

    throw new AppException(ErrorCodes.FORBIDDEN, refusalFor(test, now));
  }

  /** Reachable is not startable: the test a student may read about, or NOT_FOUND so an id is never confirmed. */
  async reachableTest(studentId: string, testId: string): Promise<ReachableTest> {
    const [reach, series] = await Promise.all([this.reachOf(studentId), this.shared()]);

    const test = reach
      ? reachedBy(series, reach)
          .flatMap((row) => row.tests)
          .find((row) => row.id === testId)
      : undefined;
    if (!test) throw new AppException(ErrorCodes.NOT_FOUND, 'No such test');

    return test;
  }

  /** What the admin screens show a student reaching: a deactivated one still reads what they would reach. Null when there is no such student. */
  async seriesReachedBy(studentId: string): Promise<SeriesReach[] | null> {
    const [student, series] = await Promise.all([
      this.prisma.student.findFirst({
        where: { id: studentId, deletedAt: null },
        select: REACH_FACTS,
      }),
      this.shared(),
    ]);
    if (!student) return null;

    const reach = reachFrom(student);
    return series.flatMap((row) => {
      const sources = sourcesOf(row, reach);
      return sources.length > 0 ? [{ id: row.id, name: row.name, sources }] : [];
    });
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

  /** The same cohort as a number. Counted on a switched-off series too: the switch is not the cohort. */
  async audienceCount(testSeriesId: string): Promise<number> {
    const series = await this.prisma.testSeries.findUnique({
      where: { id: testSeriesId },
      select: AUDIENCE_SELECT,
    });
    if (series === null) return 0;

    return this.prisma.student.count({ where: audienceOf(series) });
  }

  /** One INCR however many students there are: every process rebuilds its copy on its next read. */
  async invalidateAll(): Promise<void> {
    await this.redis.client.incr(redisKeys.catalogEpoch);
  }

  /** Concurrent readers share one build; a build that started before a bump carries the old counter, so it is replaced. */
  private async shared(): Promise<SharedSeries[]> {
    const epoch = counterOf(await this.redis.client.get(redisKeys.catalogEpoch));
    const held = this.held;
    // Any difference, not only a higher counter: a Valkey reset sends it backwards, and the bumps after it must still bite.
    if (held?.epoch === epoch && Date.now() - held.builtAt < CATALOG_MAX_AGE_MS) {
      return held.series;
    }

    const next: HeldCatalog = {
      epoch,
      builtAt: Date.now(),
      series: this.prisma.testSeries.findMany({
        where: { isEnabled: true },
        select: SHARED_SELECT,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    };
    this.held = next;
    // Not held once it fails, so the next reader retries instead of inheriting the failure.
    next.series.catch(() => {
      if (this.held === next) this.held = null;
    });
    return next.series;
  }

  /** Deleted and deactivated read as absent, which each caller turns into its own refusal. */
  private async reachOf(studentId: string): Promise<Reach | null> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: REACH_FACTS,
    });
    return student && isPresent(student) ? reachFrom(student) : null;
  }

  private async standingOf(studentId: string): Promise<Standing | null> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: STANDING_FACTS,
    });
    if (!student || !isPresent(student)) return null;

    return {
      ...reachFrom(student),
      // They arrive in attempt order and the last write wins, so the latest sitting is what shows.
      sittings: new Map(student.attempts.map((row) => [row.testId, row.status])),
    };
  }
}

const isPresent = (student: { isActive: boolean; deletedAt: Date | null }): boolean =>
  student.isActive && student.deletedAt === null;

function reachFrom(student: Prisma.StudentGetPayload<{ select: typeof REACH_FACTS }>): Reach {
  return {
    isTestBlocked: student.isTestBlocked,
    currentBranchId: student.currentBranchId,
    programs: student.programs,
    enrolledCourses: student.enrolledCourses,
    grantedSeries: new Set(student.grants.map((grant) => grant.testSeriesId)),
    events: new Set(student.eventCandidacies.map((candidacy) => candidacy.eventId)),
  };
}

function sourcesOf(row: SharedSeries, reach: Reach): StudentSeriesSource[] {
  return seriesSources({
    series: {
      kind: row.kind,
      programCode: row.programCode,
      course: row.examStage?.exam.course ?? null,
      branchIds: row.branchIds,
      granted: reach.grantedSeries.has(row.id),
      isCandidate: row.eventId !== null && reach.events.has(row.eventId),
    },
    student: reach,
  });
}

function reachedBy(series: readonly SharedSeries[], reach: Reach): SharedSeries[] {
  return series.filter((row) => sourcesOf(row, reach).length > 0);
}

function catalogOf(series: readonly SharedSeries[], standing: Standing, now: Date): StudentCatalog {
  return {
    testBlocked: standing.isTestBlocked,
    series: reachedBy(series, standing).map((row) =>
      project(toResolved(row, standing), standing.isTestBlocked, now),
    ),
  };
}

/** A corrupt counter would otherwise read as NaN, which no bump could ever move past. */
function counterOf(raw: string | null | undefined): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** What a series reaches by, and what a student carries, as `seriesSources` weighs the two. */
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

/** The one rule for reach, read from a student's side: a kind decides the automatic route, and a grant adds one. */
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

/** What a series reaches, as a STUDENT filter. The mirror of `seriesSources`; edit the two together. */
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
  const live = { deletedAt: null, isActive: true };
  // No OR at all: Prisma reads an empty member as matching NOBODY, so `{}` would empty the cohort.
  if (series.kind === TEST_SERIES_KIND.FREE) return live;

  return {
    ...live,
    // A grant overrides every kind, exactly as it does reading the other way.
    OR: [{ grants: { some: { testSeriesId: series.id } } }, ...automaticAudience(series)],
  };
}

function automaticAudience(series: Parameters<typeof audienceOf>[0]): Prisma.StudentWhereInput[] {
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

function toResolved(row: SharedSeries, standing: Standing): ResolvedSeries {
  return {
    id: row.id,
    name: row.name,
    examStage: row.examStage
      ? {
          id: row.examStage.id,
          name: row.examStage.name,
          examCode: row.examStage.exam.code,
          course: row.examStage.exam.course,
        }
      : null,
    kind: row.kind,
    sequentialTests: row.sequentialTests,
    tests: row.tests.map((test) => toResolvedTest(test, standing)).sort(byOrderThenId),
  };
}

/** Earliest of THIS student's program openings, because one in two programs is not held back by the slower one. */
function opensFor(test: ReachableTest, programs: readonly string[]): Date | null {
  const earliest = test.programUnlocks
    .filter((row) => programs.includes(row.programCode))
    .reduce<Date | null>(
      (best, row) => (best === null || row.opensAt < best ? row.opensAt : best),
      null,
    );
  return earliest ?? test.opensAt;
}

function toResolvedTest(test: ReachableTest, standing: Standing): ResolvedTest {
  const scopeRef = (test.scopeRef as TestScopeRef | null) ?? null;
  // A scoped test is its own sections' worth, and the catalog is what a student reads first.
  const scoped = scopedSections(test.baseConfig.sections, test.scope, scopeRef);

  return {
    id: test.id,
    title: test.title,
    durationSec: scopedDurationSec(test.baseConfig.sections, test.baseConfig, test.scope, scopeRef),
    sectionCount: scoped.length,
    totalQuestions: scopedQuestionCount(test.baseConfig.sections, test.scope, scopeRef),
    order: test.seriesOrder,
    opensAt: opensFor(test, standing.programs)?.toISOString() ?? null,
    attemptStatus: standing.sittings.get(test.id) ?? null,
  };
}

function project(series: ResolvedSeries, testBlocked: boolean, now: Date): StudentCatalogSeries {
  // In order means: the first one not yet sat is open, and everything past it waits its turn.
  const waiting = series.sequentialTests
    ? series.tests.findIndex((test) => !isSat(test.attemptStatus))
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

/** The clock is read HERE and never held, so a test opens on time without anything bumping a counter. */
function projectTest(test: ResolvedTest, reachable: boolean, now: Date): StudentCatalogTest {
  // A sat test stays startable: a paper may always be sat again, and Done is only where it sorts.
  return { ...test, canStart: reachable && testIsOpen(test.opensAt, now) };
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
