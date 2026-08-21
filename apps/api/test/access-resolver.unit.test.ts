import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  EXAM_FAMILY,
  SERIES_AVAILABILITY,
  TEST_STATUS,
  UNLOCK_MODE,
  UNLOCK_STATE,
  type StudentCatalog,
} from '@iace/contracts';
import { AccessResolverService } from '../src/access/access-resolver.service';
import { AccessCacheListener } from '../src/access/access-cache.listener';
import {
  FakeCatalogPrisma,
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
  return {
    prisma,
    redis,
    resolver: new AccessResolverService(prisma.asService(), redis.asService()),
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

  /** The escape hatch is not an exemption: a grant still has to pass the branch's own row. */
  it('hides a granted series the student’s branch has switched off', async () => {
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

    assert.deepEqual(seriesIds(await resolver.catalog('stu_1', NOW)), []);
  });

  /** No branch, no access — the enable flag and the window both live on the branch's row. */
  it('gives a student with no branch an empty catalog, grant and all', async () => {
    const { resolver } = build(
      reachable({
        students: [makeStudent({ id: 'stu_1', currentBranchId: null, enrolledExams: [EXAM] })],
        grants: [{ studentId: 'stu_1', testSeriesId: 'srs_1', createdById: null, createdAt: NOW }],
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

describe('AccessResolverService — the branch window', () => {
  const withWindow = (startAt: Date | null, endAt: Date | null) =>
    build(
      reachable({
        branchConfigs: [
          makeBranchConfig({ testSeriesId: 'srs_1', branchId: BRANCH, startAt, endAt }),
        ],
      }),
    ).resolver;

  const availabilityAt = async (startAt: Date | null, endAt: Date | null) =>
    (await withWindow(startAt, endAt).catalog('stu_1', NOW)).series[0];

  it('is UPCOMING before the window opens, and nothing is startable', async () => {
    const series = await availabilityAt(new Date('2026-07-01T00:00:00.000Z'), null);

    assert.equal(series?.availability, SERIES_AVAILABILITY.UPCOMING);
    assert.equal(series?.tests[0]?.canStart, false);
  });

  it('is ACTIVE inside the window', async () => {
    const series = await availabilityAt(
      new Date('2026-05-01T00:00:00.000Z'),
      new Date('2026-07-01T00:00:00.000Z'),
    );

    assert.equal(series?.availability, SERIES_AVAILABILITY.ACTIVE);
    assert.equal(series?.tests[0]?.canStart, true);
  });

  it('is ENDED after the window closes, and nothing is startable', async () => {
    const series = await availabilityAt(null, new Date('2026-05-01T00:00:00.000Z'));

    assert.equal(series?.availability, SERIES_AVAILABILITY.ENDED);
    assert.equal(series?.tests[0]?.canStart, false);
  });

  it('is ACTIVE when the branch set no window at all', async () => {
    const series = await availabilityAt(null, null);

    assert.equal(series?.availability, SERIES_AVAILABILITY.ACTIVE);
    assert.equal(series?.tests[0]?.canStart, true);
  });

  /** The window is half-open: the instant it opens is inside it, the instant it closes is not. */
  it('is ACTIVE at the exact instant the window opens', async () => {
    const series = await availabilityAt(NOW, null);

    assert.equal(series?.availability, SERIES_AVAILABILITY.ACTIVE);
    assert.equal(series?.tests[0]?.canStart, true);
  });

  it('is ENDED at the exact instant the window closes', async () => {
    const series = await availabilityAt(null, NOW);

    assert.equal(series?.availability, SERIES_AVAILABILITY.ENDED);
    assert.equal(series?.tests[0]?.canStart, false);
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
  it('crosses startAt on a cache entry that never changed', async () => {
    const startAt = new Date('2026-06-15T00:00:00.000Z');
    const { resolver, prisma } = build(
      reachable({
        branchConfigs: [makeBranchConfig({ testSeriesId: 'srs_1', branchId: BRANCH, startAt })],
      }),
    );

    const before = await resolver.catalog('stu_1', new Date('2026-06-14T23:59:00.000Z'));
    const afterFirst = prisma.queries.length;
    const after = await resolver.catalog('stu_1', new Date('2026-06-15T00:01:00.000Z'));

    assert.equal(before.series[0]?.availability, SERIES_AVAILABILITY.UPCOMING);
    assert.equal(before.series[0]?.tests[0]?.canStart, false);
    assert.equal(after.series[0]?.availability, SERIES_AVAILABILITY.ACTIVE);
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
