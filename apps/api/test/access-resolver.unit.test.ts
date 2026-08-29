import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  EXAM_FAMILY,
  ErrorCodes,
  type StudentCatalog,
  TEST_STATUS,
  UNLOCK_MODE,
  UNLOCK_STATE,
} from '@iace/contracts';
import { AccessResolverService } from '../src/access/access-resolver.service';
import { AccessCacheListener } from '../src/access/access-cache.listener';
import {
  FakeCatalogPrisma,
  FakeEventBus,
  FakeRedis,
  makeBranchConfig,
  makeSeries,
  makeStudent,
  makeTestRow,
  type FakeCatalogData,
} from './support/fakes';

/**
 * The access resolver's truth table. A student reaches a series by a grant, a program match or an
 * exam match, gated by their branch's row, and the window is applied on every read.
 */

const BRANCH = 'br_1';
const EXAM = 'SSC CGL';
const PROGRAM = 'SSC CGL FOUNDATION';
const NOW = new Date('2026-06-01T00:00:00.000Z');

function build(data: FakeCatalogData) {
  const prisma = new FakeCatalogPrisma(data);
  const redis = new FakeRedis();
  const events = new FakeEventBus();
  return {
    prisma,
    redis,
    events,
    resolver: new AccessResolverService(prisma.asService(), redis.asService(), events.asService()),
  };
}

/** One student at a branch, one series enabled there, one ACTIVE test in it. */
function reachable(over: FakeCatalogData = {}): FakeCatalogData {
  return {
    students: [makeStudent({ id: 'stu_1', currentBranchId: BRANCH, enrolledExams: [EXAM] })],
    series: [makeSeries({ id: 'srs_1' })],
    branchConfigs: [makeBranchConfig({ testSeriesId: 'srs_1', branchId: BRANCH })],
    seriesTests: [{ testSeriesId: 'srs_1', testId: 'tst_1', order: 1 }],
    tests: [makeTestRow({ id: 'tst_1' })],
    ...over,
  };
}

const seriesIds = (catalog: StudentCatalog) => catalog.series.map((series) => series.id);

describe('AccessResolverService — how a series is reached', () => {
  it('opens a series on the stage of an exam the student is enrolled in', async () => {
    const { resolver } = build(reachable());

    const catalog = await resolver.catalog('stu_1', NOW);

    assert.deepEqual(seriesIds(catalog), ['srs_1']);
    assert.equal(catalog.series[0]?.tests[0]?.canStart, true);
  });

  it('opens a program series to a student carrying the program, with no exam enrolment at all', async () => {
    const { resolver } = build(
      reachable({
        students: [
          makeStudent({
            id: 'stu_1',
            currentBranchId: BRANCH,
            enrolledExams: [],
            programs: [PROGRAM],
          }),
        ],
        series: [makeSeries({ id: 'srs_1', programCode: PROGRAM })],
      }),
    );

    assert.deepEqual(seriesIds(await resolver.catalog('stu_1', NOW)), ['srs_1']);
  });

  /**
   * THE failure this prevents: a program-tagged series is program-ONLY. Opening it on the exam
   * match alone hands a paid cohort's papers to everyone sitting the same exam.
   */
  it('does NOT open a program series to a student who only matches its exam', async () => {
    const { resolver } = build(
      reachable({ series: [makeSeries({ id: 'srs_1', programCode: PROGRAM })] }),
    );

    assert.deepEqual(seriesIds(await resolver.catalog('stu_1', NOW)), []);
  });

  /**
   * The mirror of the tests above, and what stops the exam clause being widened to "every series
   * with no programme on it": a student sitting a DIFFERENT exam must reach nothing.
   */
  it('gives nothing to a student enrolled in some other exam', async () => {
    const { resolver } = build(
      reachable({
        students: [
          makeStudent({ id: 'stu_1', currentBranchId: BRANCH, enrolledExams: ['SSC CHSL'] }),
        ],
      }),
    );

    assert.deepEqual(seriesIds(await resolver.catalog('stu_1', NOW)), []);
  });

  it('gives nothing to a student carrying some other program', async () => {
    const { resolver } = build(
      reachable({
        students: [
          makeStudent({
            id: 'stu_1',
            currentBranchId: BRANCH,
            enrolledExams: [],
            programs: ['SSC CHSL FOUNDATION'],
          }),
        ],
        series: [makeSeries({ id: 'srs_1', programCode: PROGRAM })],
      }),
    );

    assert.deepEqual(seriesIds(await resolver.catalog('stu_1', NOW)), []);
  });

  /** A family is what the institute coaches across, never an entitlement to a paper. */
  it('gives nothing on an exam family alone', async () => {
    const { resolver } = build(
      reachable({
        students: [
          makeStudent({
            id: 'stu_1',
            currentBranchId: BRANCH,
            enrolledExams: [],
            enrolledFamilies: [EXAM_FAMILY.SSC],
          }),
        ],
      }),
    );

    assert.deepEqual(seriesIds(await resolver.catalog('stu_1', NOW)), []);
  });

  it('opens a series neither the exam nor the program would, on an explicit grant', async () => {
    const { resolver } = build(
      reachable({
        students: [makeStudent({ id: 'stu_1', currentBranchId: BRANCH, enrolledExams: [] })],
        grants: [
          {
            studentId: 'stu_1',
            testSeriesId: 'srs_1',
            createdById: 'adm_1',
            createdAt: NOW,
          },
        ],
      }),
    );

    assert.deepEqual(seriesIds(await resolver.catalog('stu_1', NOW)), ['srs_1']);
  });

  it('hides a series the student’s branch has switched off', async () => {
    const { resolver } = build(
      reachable({
        branchConfigs: [
          makeBranchConfig({ testSeriesId: 'srs_1', branchId: BRANCH, enabled: false }),
        ],
      }),
    );

    assert.deepEqual(seriesIds(await resolver.catalog('stu_1', NOW)), []);
  });

  /** A branch's switch speaks for its cohort; a grant is one person, named, by an admin. */
  it('opens a granted series even where the branch has switched it off', async () => {
    const { resolver } = build(
      reachable({
        students: [makeStudent({ id: 'stu_1', currentBranchId: BRANCH, enrolledExams: [] })],
        grants: [
          { studentId: 'stu_1', testSeriesId: 'srs_1', createdById: 'adm_1', createdAt: NOW },
        ],
        branchConfigs: [
          makeBranchConfig({ testSeriesId: 'srs_1', branchId: BRANCH, enabled: false }),
        ],
      }),
    );

    assert.deepEqual(seriesIds(await resolver.catalog('stu_1', NOW)), ['srs_1']);
  });

  /** A scholarship candidate enrols outside the institute and sits at no centre of ours. */
  it('opens a granted series to a student with no branch at all', async () => {
    const { resolver } = build(
      reachable({
        students: [makeStudent({ id: 'stu_1', currentBranchId: null, enrolledExams: [] })],
        grants: [{ studentId: 'stu_1', testSeriesId: 'srs_1', createdById: null, createdAt: NOW }],
      }),
    );

    assert.deepEqual(seriesIds(await resolver.catalog('stu_1', NOW)), ['srs_1']);
  });

  /** The gate moved for grants alone: an enrolment with no branch behind it still reaches nothing. */
  it('gives a student with no branch nothing on an exam match', async () => {
    const { resolver } = build(
      reachable({
        students: [makeStudent({ id: 'stu_1', currentBranchId: null, enrolledExams: [EXAM] })],
      }),
    );

    assert.deepEqual(seriesIds(await resolver.catalog('stu_1', NOW)), []);
  });

  it('treats a soft-deleted student as one that is not there', async () => {
    const { resolver } = build(
      reachable({
        students: [
          makeStudent({ id: 'stu_1', currentBranchId: BRANCH, deletedAt: new Date('2026-05-01') }),
        ],
      }),
    );

    const error = await resolver.catalog('stu_1', NOW).catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  /** Deactivation takes the platform away, so it has to take the catalog with it. */
  it('treats a deactivated student as one that is not there', async () => {
    const { resolver } = build(
      reachable({
        students: [
          makeStudent({
            id: 'stu_1',
            currentBranchId: BRANCH,
            enrolledExams: [EXAM],
            isActive: false,
          }),
        ],
      }),
    );

    const error = await resolver.catalog('stu_1', NOW).catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  it('never shows a test that is not ACTIVE', async () => {
    const { resolver } = build(
      reachable({
        seriesTests: [
          { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
          { testSeriesId: 'srs_1', testId: 'tst_2', order: 2 },
          { testSeriesId: 'srs_1', testId: 'tst_3', order: 3 },
        ],
        tests: [
          makeTestRow({ id: 'tst_1' }),
          makeTestRow({ id: 'tst_2', status: TEST_STATUS.DRAFT }),
          makeTestRow({ id: 'tst_3', status: TEST_STATUS.INACTIVE }),
        ],
      }),
    );

    const catalog = await resolver.catalog('stu_1', NOW);

    assert.deepEqual(
      catalog.series[0]?.tests.map((test) => test.id),
      ['tst_1'],
    );
  });
});

describe('AccessResolverService — a blocked student', () => {
  const blocked = () =>
    build(
      reachable({
        students: [
          makeStudent({
            id: 'stu_1',
            currentBranchId: BRANCH,
            enrolledExams: [EXAM],
            isTestBlocked: true,
          }),
        ],
      }),
    );

  /** Blocked is view-only, not invisible: the student still sees the journey they are on. */
  it('still lists everything, with nothing startable', async () => {
    const catalog = await blocked().resolver.catalog('stu_1', NOW);

    assert.equal(catalog.testBlocked, true);
    assert.deepEqual(seriesIds(catalog), ['srs_1']);
    assert.ok(catalog.series[0]?.tests.every((test) => !test.canStart));
  });

  it('is refused at the start guard', async () => {
    const error = await blocked()
      .resolver.assertCanStart('stu_1', 'tst_1', NOW)
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.FORBIDDEN);
  });
});

describe('AccessResolverService — when a test opens', () => {
  const withTiming = (unlockAt: Date | null, lateEntrySec: number | null) =>
    build(
      reachable({
        seriesTests: [{ testSeriesId: 'srs_1', testId: 'tst_1', order: 1, unlockAt }],
        branchSchedules:
          lateEntrySec === null
            ? []
            : [{ branchId: BRANCH, testId: 'tst_1', lateEntrySec, extraTimeSec: null }],
      }),
    ).resolver;

  const testAt = async (unlockAt: Date | null, lateEntrySec: number | null = null) =>
    (await withTiming(unlockAt, lateEntrySec).catalog('stu_1', NOW)).series[0]?.tests[0];

  it('is listed but not startable before it opens', async () => {
    const test = await testAt(new Date('2026-07-01T00:00:00.000Z'));

    assert.equal(test?.canStart, false);
    assert.equal(test?.opensAt, '2026-07-01T00:00:00.000Z');
  });

  it('is startable once it has opened', async () => {
    assert.equal((await testAt(new Date('2026-05-01T00:00:00.000Z')))?.canStart, true);
  });

  it('is startable at the exact instant it opens', async () => {
    assert.equal((await testAt(NOW))?.canStart, true);
  });

  /** The failure this prevents: a series with no times set locking every student out of it. */
  it('is startable at any time when nothing schedules it', async () => {
    const test = await testAt(null);

    assert.equal(test?.canStart, true);
    assert.deepEqual([test?.opensAt, test?.closesAt], [null, null]);
  });

  it('shuts again once the branch cutoff has passed', async () => {
    const test = await testAt(new Date('2026-06-01T09:00:00.000Z'), 30 * 60);

    assert.equal(test?.closesAt, '2026-06-01T09:30:00.000Z');
    assert.equal(test?.canStart, false);
  });

  it('is still startable inside the branch cutoff', async () => {
    const opened = new Date(NOW.getTime() - 60 * 1000);

    assert.equal((await testAt(opened, 30 * 60))?.canStart, true);
  });

  /** A cutoff counted from nothing must not shut a test that was never scheduled. */
  it('ignores a cutoff on a test with no opening time', async () => {
    const test = await testAt(null, 30 * 60);

    assert.equal(test?.closesAt, null);
    assert.equal(test?.canStart, true);
  });
});

describe('AccessResolverService — the order the catalog comes back in', () => {
  /** Two series can share a name; without the id tiebreak they swap places between reads. */
  it('breaks a tie on id, so the same catalog reads the same way twice', async () => {
    const { resolver } = build(
      reachable({
        series: [
          makeSeries({ id: 'srs_b', name: 'Mock series' }),
          makeSeries({ id: 'srs_a', name: 'Mock series' }),
        ],
        branchConfigs: [
          makeBranchConfig({ testSeriesId: 'srs_a', branchId: BRANCH }),
          makeBranchConfig({ testSeriesId: 'srs_b', branchId: BRANCH }),
        ],
      }),
    );

    assert.deepEqual(seriesIds(await resolver.catalog('stu_1', NOW)), ['srs_a', 'srs_b']);
  });
});

describe('AccessResolverService — a series behind a prerequisite', () => {
  const gated = (over: FakeCatalogData = {}) =>
    build(
      reachable({
        series: [
          makeSeries({ id: 'srs_0', name: 'Foundation mocks' }),
          makeSeries({
            id: 'srs_1',
            name: 'Advanced mocks',
            prerequisiteSeriesId: 'srs_0',
            unlockMode: UNLOCK_MODE.REQUEST,
          }),
        ],
        branchConfigs: [makeBranchConfig({ testSeriesId: 'srs_1', branchId: BRANCH })],
        ...over,
      }),
    );

  it('is LOCKED and still listed, naming what has to come first', async () => {
    const catalog = await gated().resolver.catalog('stu_1', NOW);

    const series = catalog.series[0];
    assert.equal(series?.unlockState, UNLOCK_STATE.LOCKED);
    assert.equal(series?.prerequisiteSeriesName, 'Foundation mocks');
    assert.equal(series?.canRequestUnlock, true);
    assert.ok(series?.tests.every((test) => !test.canStart));
  });

  it('opens once an unlock row carries a time', async () => {
    const catalog = await gated({
      unlocks: [{ studentId: 'stu_1', testSeriesId: 'srs_1', unlockedAt: new Date('2026-05-20') }],
    }).resolver.catalog('stu_1', NOW);

    const series = catalog.series[0];
    assert.equal(series?.unlockState, UNLOCK_STATE.UNLOCKED);
    assert.equal(series?.canRequestUnlock, false);
    assert.equal(series?.tests[0]?.canStart, true);
  });

  /** An unlock row that was never granted a time is not an unlock. */
  it('stays LOCKED while the unlock row has no time on it', async () => {
    const catalog = await gated({
      unlocks: [{ studentId: 'stu_1', testSeriesId: 'srs_1', unlockedAt: null }],
    }).resolver.catalog('stu_1', NOW);

    assert.equal(catalog.series[0]?.unlockState, UNLOCK_STATE.LOCKED);
  });
});

describe('AccessResolverService — a series that never opens on its own', () => {
  const byMode = (unlockMode: (typeof UNLOCK_MODE)[keyof typeof UNLOCK_MODE]) =>
    build(reachable({ series: [makeSeries({ id: 'srs_1', unlockMode })] }));

  /** The failure this prevents: REQUEST and ADMIN reduced to decoration on an open series. */
  it('holds a REQUEST series LOCKED with nothing to come first, and offers the request', async () => {
    const catalog = await byMode(UNLOCK_MODE.REQUEST).resolver.catalog('stu_1', NOW);

    const series = catalog.series[0];
    assert.equal(series?.prerequisiteSeriesId, null);
    assert.equal(series?.unlockState, UNLOCK_STATE.LOCKED);
    assert.equal(series?.canRequestUnlock, true);
    assert.ok(series?.tests.every((test) => !test.canStart));
  });

  it('holds an ADMIN series LOCKED and offers no request — an admin grants it or nobody does', async () => {
    const catalog = await byMode(UNLOCK_MODE.ADMIN).resolver.catalog('stu_1', NOW);

    assert.equal(catalog.series[0]?.unlockState, UNLOCK_STATE.LOCKED);
    assert.equal(catalog.series[0]?.canRequestUnlock, false);
  });

  it('opens either one once an unlock row carries a time', async () => {
    const catalog = await build(
      reachable({
        series: [makeSeries({ id: 'srs_1', unlockMode: UNLOCK_MODE.ADMIN })],
        unlocks: [
          { studentId: 'stu_1', testSeriesId: 'srs_1', unlockedAt: new Date('2026-05-20') },
        ],
      }),
    ).resolver.catalog('stu_1', NOW);

    assert.equal(catalog.series[0]?.unlockState, UNLOCK_STATE.UNLOCKED);
    assert.equal(catalog.series[0]?.tests[0]?.canStart, true);
  });

  it('leaves an AUTO series with no prerequisite open, needing no row at all', async () => {
    const catalog = await byMode(UNLOCK_MODE.AUTO).resolver.catalog('stu_1', NOW);

    assert.equal(catalog.series[0]?.unlockState, UNLOCK_STATE.UNLOCKED);
    assert.equal(catalog.series[0]?.tests[0]?.canStart, true);
  });
});

describe('AccessResolverService.assertCanStart', () => {
  it('passes for an active, unlocked test the student reaches', async () => {
    const { resolver } = build(reachable());

    await assert.doesNotReject(() => resolver.assertCanStart('stu_1', 'tst_1', NOW));
  });

  /** The guard and the catalog share one resolution, so they can never disagree. */
  it('refuses a test that is in no series the student reaches', async () => {
    const { resolver } = build(
      reachable({ series: [makeSeries({ id: 'srs_1', programCode: PROGRAM })] }),
    );

    const error = await resolver.assertCanStart('stu_1', 'tst_1', NOW).catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.FORBIDDEN);
  });

  /**
   * THE failure this prevents: the bust is best-effort, so a Redis blip would otherwise leave a
   * just-blocked student starting tests for the rest of the entry's 15 minutes.
   */
  it('refuses the moment a block lands, on a cache entry nothing busted', async () => {
    const student = makeStudent({ id: 'stu_1', currentBranchId: BRANCH, enrolledExams: [EXAM] });
    const { resolver } = build(reachable({ students: [student] }));
    await resolver.assertCanStart('stu_1', 'tst_1', NOW);

    student.isTestBlocked = true;

    const error = await resolver.assertCanStart('stu_1', 'tst_1', NOW).catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.FORBIDDEN);
  });

  it('refuses the moment the student is deactivated, on a cache entry nothing busted', async () => {
    const student = makeStudent({ id: 'stu_1', currentBranchId: BRANCH, enrolledExams: [EXAM] });
    const { resolver } = build(reachable({ students: [student] }));
    await resolver.assertCanStart('stu_1', 'tst_1', NOW);

    student.isActive = false;

    const error = await resolver.assertCanStart('stu_1', 'tst_1', NOW).catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.FORBIDDEN);
  });
});

describe('AccessResolverService — the cache', () => {
  it('answers a second read without touching Postgres', async () => {
    const { resolver, prisma } = build(reachable());

    await resolver.catalog('stu_1', NOW);
    const afterFirst = prisma.queries.length;
    await resolver.catalog('stu_1', NOW);

    assert.ok(afterFirst > 0);
    assert.equal(prisma.queries.length, afterFirst);
  });

  it('recomputes one student after their own access changes', async () => {
    const { resolver, prisma } = build(reachable());
    await resolver.catalog('stu_1', NOW);
    const afterFirst = prisma.queries.length;

    await resolver.invalidateStudent('stu_1');
    await resolver.catalog('stu_1', NOW);

    assert.ok(prisma.queries.length > afterFirst);
  });

  /**
   * THE race a DEL cannot survive: the bust lands after the miss and before the write, so the
   * pre-change answer would be written back and served for the whole TTL — a revoked grant, or a
   * block, live for 15 more minutes.
   */
  it('honours a bust that lands mid-resolve, instead of re-pinning the old answer', async () => {
    const branchConfig = makeBranchConfig({ testSeriesId: 'srs_1', branchId: BRANCH });
    const { resolver, prisma } = build(reachable({ branchConfigs: [branchConfig] }));
    prisma.onQuery = async (name) => {
      if (name !== 'testSeries.findMany') return;
      prisma.onQuery = null;
      await resolver.invalidateStudent('stu_1');
    };

    assert.deepEqual(seriesIds(await resolver.catalog('stu_1', NOW)), ['srs_1']);
    branchConfig.enabled = false;

    assert.deepEqual(seriesIds(await resolver.catalog('stu_1', NOW)), []);
  });

  it('leaves every other student’s entry alone when one student is busted', async () => {
    const two = reachable({
      students: [
        makeStudent({ id: 'stu_1', currentBranchId: BRANCH, enrolledExams: [EXAM] }),
        makeStudent({ id: 'stu_2', currentBranchId: BRANCH, enrolledExams: [EXAM] }),
      ],
    });
    const { resolver, prisma } = build(two);
    await resolver.catalog('stu_1', NOW);
    await resolver.catalog('stu_2', NOW);
    const afterBoth = prisma.queries.length;

    await resolver.invalidateStudent('stu_1');
    await resolver.catalog('stu_2', NOW);

    assert.equal(prisma.queries.length, afterBoth);
  });

  /** A series-wide change is one INCR, not a scan: every student falls out of cache at once. */
  it('recomputes for everyone when the catalog itself changes', async () => {
    const { resolver, prisma } = build(
      reachable({
        students: [
          makeStudent({ id: 'stu_1', currentBranchId: BRANCH, enrolledExams: [EXAM] }),
          makeStudent({ id: 'stu_2', currentBranchId: BRANCH, enrolledExams: [EXAM] }),
        ],
      }),
    );
    await resolver.catalog('stu_1', NOW);
    await resolver.catalog('stu_2', NOW);
    const afterBoth = prisma.queries.length;

    await resolver.invalidateAll();
    await resolver.catalog('stu_1', NOW);
    const afterFirstRecompute = prisma.queries.length;
    await resolver.catalog('stu_2', NOW);

    assert.ok(afterFirstRecompute > afterBoth);
    assert.ok(prisma.queries.length > afterFirstRecompute);
  });

  /**
   * WHY the window is not cached: the same cached entry has to answer UPCOMING before the
   * branch's start time and ACTIVE after it, with nothing invalidating it in between. Caching
   * availability would leave a series shut until something happened to bust the key.
   */
  it('crosses an opening time on a cache entry that never changed', async () => {
    const unlockAt = new Date('2026-06-15T00:00:00.000Z');
    const { resolver, prisma } = build(
      reachable({ seriesTests: [{ testSeriesId: 'srs_1', testId: 'tst_1', order: 1, unlockAt }] }),
    );

    const before = await resolver.catalog('stu_1', new Date('2026-06-14T23:59:00.000Z'));
    const afterFirst = prisma.queries.length;
    const after = await resolver.catalog('stu_1', new Date('2026-06-15T00:01:00.000Z'));

    assert.equal(before.series[0]?.tests[0]?.canStart, false);
    assert.equal(after.series[0]?.tests[0]?.canStart, true);
    assert.equal(prisma.queries.length, afterFirst);
  });
});

describe('AccessCacheListener', () => {
  it('busts one student on student.access_changed', async () => {
    const { resolver, prisma } = build(
      reachable({
        students: [
          makeStudent({ id: 'stu_1', currentBranchId: BRANCH, enrolledExams: [EXAM] }),
          makeStudent({ id: 'stu_2', currentBranchId: BRANCH, enrolledExams: [EXAM] }),
        ],
      }),
    );
    const listener = new AccessCacheListener(resolver);
    await resolver.catalog('stu_1', NOW);
    await resolver.catalog('stu_2', NOW);
    const afterBoth = prisma.queries.length;

    await listener.onStudentAccessChanged({ studentId: 'stu_1' });
    await resolver.catalog('stu_2', NOW);
    const afterOther = prisma.queries.length;
    await resolver.catalog('stu_1', NOW);

    assert.equal(afterOther, afterBoth);
    assert.ok(prisma.queries.length > afterOther);
  });

  it('busts everyone on access.catalog_changed', async () => {
    const { resolver, prisma } = build(reachable());
    const listener = new AccessCacheListener(resolver);
    await resolver.catalog('stu_1', NOW);
    const afterFirst = prisma.queries.length;

    await listener.onCatalogChanged({ testSeriesId: 'srs_1' });
    await resolver.catalog('stu_1', NOW);

    assert.ok(prisma.queries.length > afterFirst);
  });

  /** The write already happened. A Redis blip must not fail the request behind it. */
  it('swallows a failing bust rather than failing the producer', async () => {
    const failing = {
      invalidateStudent: () => Promise.reject(new Error('redis is down')),
      invalidateAll: () => Promise.reject(new Error('redis is down')),
    } as unknown as AccessResolverService;
    const listener = new AccessCacheListener(failing);

    await assert.doesNotReject(() => listener.onStudentAccessChanged({ studentId: 'stu_1' }));
    await assert.doesNotReject(() => listener.onCatalogChanged({ testSeriesId: null }));
  });
});

describe('AccessResolverService — a series that unlocks in order', () => {
  const inOrder = (attempts: { studentId: string; testId: string; status: string }[] = []) =>
    build(
      reachable({
        series: [makeSeries({ id: 'srs_1', sequentialTests: true })],
        seriesTests: [
          { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
          { testSeriesId: 'srs_1', testId: 'tst_2', order: 2 },
          { testSeriesId: 'srs_1', testId: 'tst_3', order: 3 },
        ],
        tests: [
          makeTestRow({ id: 'tst_1' }),
          makeTestRow({ id: 'tst_2' }),
          makeTestRow({ id: 'tst_3' }),
        ],
        attempts,
      }),
    ).resolver;

  const startable = async (attempts: Parameters<typeof inOrder>[0] = []) =>
    (await inOrder(attempts).catalog('stu_1', NOW)).series[0]?.tests.map((test) => test.canStart);

  /** The failure this prevents: a flag on screen saying "in order" while every test is open. */
  it('opens the first and holds the rest', async () => {
    assert.deepEqual(await startable(), [true, false, false]);
  });

  it('opens the next one once its predecessor has been sat', async () => {
    const sat = [{ studentId: 'stu_1', testId: 'tst_1', status: 'SUBMITTED' }];

    assert.deepEqual(await startable(sat), [true, true, false]);
  });

  it('counts an evaluated sitting as sat, and leaves nothing shut once all are', async () => {
    const all = ['tst_1', 'tst_2', 'tst_3'].map((testId) => ({
      studentId: 'stu_1',
      testId,
      status: 'EVALUATED',
    }));

    assert.deepEqual(await startable(all), [true, true, true]);
  });

  it('does not count a sitting still in progress', async () => {
    const live = [{ studentId: 'stu_1', testId: 'tst_1', status: 'IN_PROGRESS' }];

    assert.deepEqual(await startable(live), [true, false, false]);
  });

  it('holds nothing back when the series does not unlock in order', async () => {
    const open = build(
      reachable({
        seriesTests: [
          { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
          { testSeriesId: 'srs_1', testId: 'tst_2', order: 2 },
        ],
        tests: [makeTestRow({ id: 'tst_1' }), makeTestRow({ id: 'tst_2' })],
      }),
    ).resolver;

    const series = (await open.catalog('stu_1', NOW)).series[0];

    assert.deepEqual(
      series?.tests.map((test) => test.canStart),
      [true, true],
    );
  });

  it('refuses one still waiting its turn at the start guard', async () => {
    const error = await inOrder()
      .assertCanStart('stu_1', 'tst_2', NOW)
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.FORBIDDEN);
  });
});
