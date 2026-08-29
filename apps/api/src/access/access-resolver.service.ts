import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  AppException,
  type AttemptStatus,
  ErrorCodes,
  type StudentCatalog,
  type StudentCatalogSeries,
  type StudentCatalogTest,
  TEST_STATUS,
  type TestSeriesKind,
  UNLOCK_REQUEST_STATUS,
  UNLOCK_STATE,
  type UnlockMode,
  type UnlockState,
  testIsOpen,
  testWindow,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { redisKeys } from '../redis/redis.keys';
import { DomainEventBus } from '../common/events';
import { applyAutoUnlocks, needsUnlock } from './auto-unlock';

/** A sitting that counts as done — for the series that unlocks in order, and for the test list. */
const FINISHED = new Set<AttemptStatus>([ATTEMPT_STATUS.SUBMITTED, ATTEMPT_STATUS.EVALUATED]);

/** A safety net under the event-driven busts, never the mechanism that keeps the catalog right. */
const CATALOG_TTL_SEC = 15 * 60;

/**
 * Bump on every change to `ResolvedCatalog`: the epochs survive a deploy, so without this a
 * payload the previous build wrote is read back as the new shape until its TTL runs out.
 */
const CATALOG_SHAPE = 'v5';

const catalogInclude = (branchId: string | null) =>
  ({
    examStage: { select: { id: true, name: true, exam: { select: { code: true } } } },
    prerequisiteSeries: { select: { name: true } },
    // The `access` → `Test` seam docs/03 §4 records: the tests module does not exist yet, so
    // there is no facade to ask and the read is made here.
    tests: {
      where: { test: { status: TEST_STATUS.ACTIVE } },
      select: {
        order: true,
        unlockAt: true,
        test: {
          select: {
            id: true,
            title: true,
            branchSchedules: {
              // No branch, no row, which is already what "no row" means: the plain timing rules.
              where: { branchId: { in: branchId === null ? [] : [branchId] } },
              select: { lateEntrySec: true, extraTimeSec: true },
            },
          },
        },
      },
    },
  }) as const satisfies Prisma.TestSeriesInclude;

type CatalogRow = Prisma.TestSeriesGetPayload<{ include: ReturnType<typeof catalogInclude> }>;

interface ResolvedTest {
  id: string;
  title: string | null;
  order: number | null;
  /** The window, resolved once. `canStart` is derived from the CLOCK on every read, never cached. */
  opensAt: string | null;
  closesAt: string | null;
  /** Where this student got to. Cached, and busted when a sitting starts or ends. */
  attemptStatus: AttemptStatus | null;
  /** This branch's, in seconds, so the deadline is computed from one duration and not two. */
  extraTimeSec: number | null;
}

/** What is cached: everything the clock does NOT decide. */
interface ResolvedSeries {
  id: string;
  name: string;
  description: string | null;
  examStage: { id: string; name: string; examCode: string } | null;
  programCode: string | null;
  kind: TestSeriesKind;
  sequentialTests: boolean;
  unlockMode: UnlockMode;
  unlockState: UnlockState;
  prerequisiteSeriesId: string | null;
  prerequisiteSeriesName: string | null;
  unlockRequested: boolean;
  tests: ResolvedTest[];
}

interface ResolvedCatalog {
  testBlocked: boolean;
  series: ResolvedSeries[];
}

interface FreshCatalog {
  catalog: ResolvedCatalog;
  opened: boolean;
}

/**
 * The one place "can this student reach this?" is answered. A student reaches a series by an
 * explicit grant, a program match or an exam match, and every one of those is then gated by the
 * `BranchTestConfig` row for their branch.
 */
@Injectable()
export class AccessResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly events: DomainEventBus,
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

  /** What this student's branch adds to the clock here — from the catalog the gate just read. */
  async extraTimeSecFor(studentId: string, testId: string): Promise<number> {
    const resolved = await this.resolved(studentId);
    const test = resolved.series.flatMap((series) => series.tests).find((row) => row.id === testId);
    return test?.extraTimeSec ?? 0;
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

    const { catalog, opened } = await this.resolve(studentId);
    // An unlock this read performed busts the epoch `key` was built from, so the entry would be
    // dead the moment it was written — and the read that follows recomputes anyway.
    if (!opened) await this.redis.setJson(key, catalog, CATALOG_TTL_SEC);
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

  private async resolve(studentId: string): Promise<FreshCatalog> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null, isActive: true },
      select: {
        isTestBlocked: true,
        currentBranchId: true,
        programs: true,
        enrolledExams: true,
      },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, 'No such student');

    const rows = await this.prisma.testSeries.findMany({
      where: reachableBy(studentId, student),
      include: catalogInclude(student.currentBranchId),
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    const sittings = await this.sittings(studentId);
    // Before the unlock state is read, so a series this call opens is UNLOCKED in this call.
    const opened = await applyAutoUnlocks(
      this.prisma,
      this.events,
      studentId,
      rows,
      finishedTests(sittings),
      new Date(),
    );
    const unlocked = await this.unlockedIds(studentId, rows);
    for (const id of opened) unlocked.add(id);
    const asked = await this.askedIds(studentId);

    return {
      catalog: {
        testBlocked: student.isTestBlocked,
        series: rows.map((row) => toResolved(row, unlocked, asked, sittings)),
      },
      opened: opened.length > 0,
    };
  }

  /** The asks still in the queue, so a locked series can offer waiting instead of asking again. */
  private async askedIds(studentId: string): Promise<Set<string>> {
    const rows = await this.prisma.seriesUnlockRequest.findMany({
      where: { studentId, status: UNLOCK_REQUEST_STATUS.PENDING },
      select: { testSeriesId: true },
    });
    return new Set(rows.map((row) => row.testSeriesId));
  }

  private async unlockedIds(studentId: string, rows: CatalogRow[]): Promise<Set<string>> {
    const gated = rows.filter(needsUnlock).map((row) => row.id);
    if (gated.length === 0) return new Set();

    const unlocks = await this.prisma.studentSeriesUnlock.findMany({
      where: { studentId, testSeriesId: { in: gated }, unlockedAt: { not: null } },
      select: { testSeriesId: true },
    });
    return new Set(unlocks.map((row) => row.testSeriesId));
  }
}

/** A corrupt counter would otherwise make the key NaN — stable, so every later bust is a no-op. */
function counterOf(raw: string | null | undefined): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** One where-input for reach, asked by all three readers; a grant sits OUTSIDE the branch gate. */
export function reachableBy(
  studentId: string,
  student: Readonly<{
    currentBranchId: string | null;
    programs: string[];
    enrolledExams: string[];
  }>,
): Prisma.TestSeriesWhereInput {
  const automatic: Prisma.TestSeriesWhereInput[] = [
    ...(student.programs.length > 0 ? [{ programCode: { in: student.programs } }] : []),
    // `programCode: null` is what makes a program-tagged series program-ONLY: an exam
    // enrolment alone must never open one.
    ...(student.enrolledExams.length > 0
      ? [{ programCode: null, examStage: { exam: { code: { in: student.enrolledExams } } } }]
      : []),
  ];

  const branchId = student.currentBranchId;
  const gated: Prisma.TestSeriesWhereInput[] =
    branchId === null || automatic.length === 0
      ? []
      : [{ branchConfigs: { some: { branchId, enabled: true } }, OR: automatic }];

  return { OR: [{ grants: { some: { studentId } } }, ...gated] };
}

function toResolved(
  row: CatalogRow,
  unlocked: Set<string>,
  asked: ReadonlySet<string>,
  sittings: ReadonlyMap<string, AttemptStatus>,
): ResolvedSeries {
  const locked = needsUnlock(row) && !unlocked.has(row.id);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    examStage: row.examStage
      ? { id: row.examStage.id, name: row.examStage.name, examCode: row.examStage.exam.code }
      : null,
    programCode: row.programCode,
    kind: row.kind,
    sequentialTests: row.sequentialTests,
    unlockMode: row.unlockMode,
    unlockState: locked ? UNLOCK_STATE.LOCKED : UNLOCK_STATE.UNLOCKED,
    prerequisiteSeriesId: row.prerequisiteSeriesId,
    prerequisiteSeriesName: row.prerequisiteSeries?.name ?? null,
    unlockRequested: asked.has(row.id),
    tests: row.tests.map((link) => toResolvedTest(link, sittings)).sort(byOrderThenId),
  };
}

function toResolvedTest(
  link: CatalogRow['tests'][number],
  sittings: ReadonlyMap<string, AttemptStatus>,
): ResolvedTest {
  const branch = link.test.branchSchedules[0];
  const window = testWindow({
    unlockAt: link.unlockAt?.toISOString() ?? null,
    lateEntrySec: branch?.lateEntrySec ?? null,
  });

  return {
    id: link.test.id,
    title: link.test.title,
    order: link.order,
    ...window,
    attemptStatus: sittings.get(link.test.id) ?? null,
    extraTimeSec: branch?.extraTimeSec ?? null,
  };
}

const isFinished = (status: AttemptStatus | null): boolean =>
  status !== null && FINISHED.has(status);

/** What a prerequisite series is measured in: the tests this student has actually sat. */
function finishedTests(sittings: ReadonlyMap<string, AttemptStatus>): Set<string> {
  const done = new Set<string>();
  for (const [testId, status] of sittings) if (isFinished(status)) done.add(testId);
  return done;
}

function project(series: ResolvedSeries, testBlocked: boolean, now: Date): StudentCatalogSeries {
  const reachable = series.unlockState === UNLOCK_STATE.UNLOCKED && !testBlocked;
  // In order means: the first one not yet sat is open, and everything past it waits its turn.
  const waiting = series.sequentialTests
    ? series.tests.findIndex((test) => !isFinished(test.attemptStatus))
    : NONE_WAITING;

  return {
    ...series,
    canRequestUnlock: series.unlockState === UNLOCK_STATE.LOCKED,
    tests: series.tests.map((test, index) =>
      projectTest(test, reachable && (waiting === NONE_WAITING || index <= waiting), now),
    ),
  };
}

/** `findIndex` returns -1 when every test is sat, which is also "nothing is waiting its turn". */
const NONE_WAITING = -1;

/** The clock is read HERE and never cached, so a test opens on time without anything busting a key. */
function projectTest(test: ResolvedTest, reachable: boolean, now: Date): StudentCatalogTest {
  const { extraTimeSec: _extraTimeSec, ...shown } = test;
  // A sat test stays startable: `maxRetakes` decides whether it may be sat again, not this.
  return { ...shown, canStart: reachable && testIsOpen(test, now) };
}

/** Why a sitting may not begin: a shut window is a different fact from having no access at all. */
function refusalFor(test: StudentCatalogTest | undefined, now: Date): string {
  const at = now.getTime();
  if (test && test.opensAt !== null && Date.parse(test.opensAt) > at) {
    return 'This test has not opened yet';
  }
  if (test && test.closesAt !== null && Date.parse(test.closesAt) <= at) {
    return 'Entry to this test has closed';
  }
  return 'This test is not open to you right now';
}

/** An unordered test sorts last, and the id keeps the order stable when two share one. */
const ORDERED_LAST = Number.MAX_SAFE_INTEGER;

function byOrderThenId(left: ResolvedTest, right: ResolvedTest): number {
  return (
    (left.order ?? ORDERED_LAST) - (right.order ?? ORDERED_LAST) || left.id.localeCompare(right.id)
  );
}
