import { EVERY_BRANCH } from '../src/common/security';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  ATTEMPT_STATUS,
  EXAM_COURSE,
  ErrorCodes,
  STUDENT_TYPE,
  TEST_SERIES_KIND,
  UNLOCK_MODE,
  UNLOCK_REQUEST_STATUS,
  UNLOCK_STATE,
} from '@iace/contracts';
import { AccessResolverService } from '../src/access/access-resolver.service';
import { AccessCacheListener } from '../src/access/access-cache.listener';
import { UnlocksService } from '../src/access/unlocks.service';
import { AuditContext } from '../src/audit';
import { DOMAIN_EVENTS } from '../src/common/events';
import {
  type FakeCatalogData,
  FakeCatalogPrisma,
  FakeEventBus,
  type FakeGrantRowAccess,
  FakeRedis,
  type FakeUnlockRequestRow,
  type FakeUnlockRow,
  makeBranchConfig,
  makeExam,
  makeExamStage,
  makeSeries,
  makeStudent,
  makeTestRow,
} from './support/fakes';

/**
 * Unlocks. An unlock is not a way to REACH a series — the branch gate and the three reach paths
 * decide that — so everything here can only open something the student already reaches.
 */

const BRANCH = 'br_1';
const EXAM = 'SSC CGL';
const NOW = new Date('2026-06-01T00:00:00.000Z');
const ADMIN = 'adm_1';

interface World {
  unlocks: FakeUnlockRow[];
  requests: FakeUnlockRequestRow[];
  grants: FakeGrantRowAccess[];
}

function build(data: FakeCatalogData = {}) {
  const world: World = {
    unlocks: data.unlocks ?? [],
    requests: data.unlockRequests ?? [],
    grants: data.grants ?? [],
  };
  const prisma = new FakeCatalogPrisma({
    ...data,
    unlocks: world.unlocks,
    unlockRequests: world.requests,
    grants: world.grants,
  });
  const redis = new FakeRedis();
  const events = new FakeEventBus();
  const resolver = new AccessResolverService(
    prisma.asService(),
    redis.asService(),
    events.asService(),
  );

  return {
    world,
    prisma,
    events,
    resolver,
    listener: new AccessCacheListener(resolver),
    service: new UnlocksService(
      prisma.asService(),
      resolver,
      new AuditContext(),
      events.asService(),
    ),
  };
}

/** One student at a branch, one series enabled there, one ACTIVE test in it. */
function reachable(over: FakeCatalogData = {}): FakeCatalogData {
  return {
    students: [makeStudent({ id: 'stu_1', currentBranchId: BRANCH, enrolledExams: [EXAM] })],
    series: [makeSeries({ id: 'srs_1', unlockMode: UNLOCK_MODE.REQUEST })],
    branchConfigs: [makeBranchConfig({ testSeriesId: 'srs_1', branchId: BRANCH })],
    seriesTests: [{ testSeriesId: 'srs_1', testId: 'tst_1', order: 1 }],
    tests: [makeTestRow({ id: 'tst_1' })],
    ...over,
  };
}

/** Advanced sits behind Foundation and the student has sat nothing — the early-unlock case. */
function waitingOnPrerequisite(over: FakeCatalogData = {}): FakeCatalogData {
  return reachable({
    series: [
      makeSeries({ id: 'srs_0', name: 'Foundation mocks' }),
      makeSeries({ id: 'srs_1', name: 'Advanced mocks', prerequisiteSeriesId: 'srs_0' }),
    ],
    branchConfigs: chainConfigs(['srs_0', 'srs_1']),
    seriesTests: [
      { testSeriesId: 'srs_0', testId: 'tst_0', order: 1 },
      { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
    ],
    tests: [makeTestRow({ id: 'tst_0' }), makeTestRow({ id: 'tst_1' })],
    ...over,
  });
}

/** Delivers what the producer announced, exactly as the cache listener does in the app. */
async function deliverBusts(events: FakeEventBus, listener: AccessCacheListener): Promise<void> {
  for (const payload of events.of(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED)) {
    await listener.onStudentAccessChanged(payload);
  }
}

const stateOf = async (resolver: AccessResolverService, id = 'srs_1') =>
  (await resolver.catalog('stu_1', NOW)).series.find((series) => series.id === id)?.unlockState;

/** One catalog read, every series' state off it — what a chain has to answer in a single pass. */
async function statesOf(resolver: AccessResolverService): Promise<Map<string, string>> {
  const catalog = await resolver.catalog('stu_1', NOW);
  return new Map(catalog.series.map((series) => [series.id, series.unlockState]));
}

function chainConfigs(ids: readonly string[]) {
  return ids.map((id, index) =>
    makeBranchConfig({ id: `btc_${index}`, testSeriesId: id, branchId: BRANCH }),
  );
}

describe('auto-unlock — a series that opens itself on the read that reaches it', () => {
  /** Foundation is open to the student AND sat; Advanced sits behind it. */
  const chained = (over: FakeCatalogData = {}) =>
    build(
      reachable({
        series: [
          makeSeries({ id: 'srs_0', name: 'Foundation mocks', unlockMode: UNLOCK_MODE.REQUEST }),
          makeSeries({
            id: 'srs_1',
            name: 'Advanced mocks',
            prerequisiteSeriesId: 'srs_0',
            unlockMode: UNLOCK_MODE.AUTO,
          }),
        ],
        branchConfigs: chainConfigs(['srs_0', 'srs_1']),
        seriesTests: [
          { testSeriesId: 'srs_0', testId: 'tst_0', order: 1 },
          { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
        ],
        tests: [makeTestRow({ id: 'tst_0' }), makeTestRow({ id: 'tst_1' })],
        unlocks: [
          { studentId: 'stu_1', testSeriesId: 'srs_0', unlockedAt: new Date('2026-05-01') },
        ],
        attempts: [{ studentId: 'stu_1', testId: 'tst_0', status: ATTEMPT_STATUS.SUBMITTED }],
        ...over,
      }),
    );

  it('opens on resolve, and the SAME call already reads UNLOCKED', async () => {
    const { resolver, world } = chained();

    assert.equal(await stateOf(resolver), UNLOCK_STATE.UNLOCKED);
    assert.ok(world.unlocks.some((row) => row.testSeriesId === 'srs_1' && row.unlockedAt !== null));
  });

  it('tells the platform, so every other cached shape of this student falls out', async () => {
    const { resolver, events } = chained();

    await resolver.catalog('stu_1', NOW);

    assert.deepEqual(events.of(DOMAIN_EVENTS.SERIES_UNLOCKED), [
      { studentId: 'stu_1', testSeriesId: 'srs_1' },
    ]);
    assert.deepEqual(events.of(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED), [{ studentId: 'stu_1' }]);
  });

  /**
   * THE failure this prevents: a re-read that re-stamps `unlockedAt` makes "when did this open"
   * mean "when was this last looked at", and nothing downstream can tell them apart.
   */
  it('does not move a time it has already set, however often it is re-read', async () => {
    const { resolver, world, listener, events } = chained();
    await resolver.catalog('stu_1', NOW);
    const opened = world.unlocks.find((row) => row.testSeriesId === 'srs_1')?.unlockedAt;

    await deliverBusts(events, listener);
    await resolver.catalog('stu_1', NOW);

    assert.equal(world.unlocks.filter((row) => row.testSeriesId === 'srs_1').length, 1);
    assert.equal(world.unlocks.find((row) => row.testSeriesId === 'srs_1')?.unlockedAt, opened);
    assert.deepEqual(events.of(DOMAIN_EVENTS.SERIES_UNLOCKED).length, 1);
  });

  /** THE rule this change made: opening the prerequisite is not finishing it, and only one opens. */
  it('leaves an AUTO series shut while the prerequisite is open but unsat', async () => {
    const { resolver, world } = chained({ attempts: [] });

    assert.equal(await stateOf(resolver), UNLOCK_STATE.LOCKED);
    assert.deepEqual(
      world.unlocks.map((row) => row.testSeriesId),
      ['srs_0'],
      'the fixture opened the prerequisite; nothing opened the series behind it',
    );
  });

  it('stays shut while only some of what comes first is sat', async () => {
    const { resolver } = chained({
      seriesTests: [
        { testSeriesId: 'srs_0', testId: 'tst_0', order: 1 },
        { testSeriesId: 'srs_0', testId: 'tst_0b', order: 2 },
        { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
      ],
      tests: [
        makeTestRow({ id: 'tst_0' }),
        makeTestRow({ id: 'tst_0b' }),
        makeTestRow({ id: 'tst_1' }),
      ],
    });

    assert.equal(await stateOf(resolver), UNLOCK_STATE.LOCKED);
  });

  /** A prerequisite holding no tests has nothing anyone can finish, so it never counts as done. */
  it('stays shut behind a prerequisite that has no tests in it at all', async () => {
    const { resolver } = chained({
      seriesTests: [{ testSeriesId: 'srs_1', testId: 'tst_1', order: 1 }],
      tests: [makeTestRow({ id: 'tst_1' })],
      attempts: [],
    });

    assert.equal(await stateOf(resolver), UNLOCK_STATE.LOCKED);
  });

  /** REQUEST never opens on its own — that is the whole difference from AUTO. */
  it('never auto-opens a REQUEST series, prerequisite finished or not', async () => {
    const { resolver, world, events } = chained({
      series: [
        makeSeries({ id: 'srs_0', name: 'Foundation mocks', unlockMode: UNLOCK_MODE.REQUEST }),
        makeSeries({
          id: 'srs_1',
          name: 'Advanced mocks',
          prerequisiteSeriesId: 'srs_0',
          unlockMode: UNLOCK_MODE.REQUEST,
        }),
      ],
    });

    assert.equal(await stateOf(resolver), UNLOCK_STATE.LOCKED);
    assert.equal(world.unlocks.length, 1, 'only the prerequisite the fixture opened');
    assert.deepEqual(events.of(DOMAIN_EVENTS.SERIES_UNLOCKED), []);
  });

  /** A prerequisite needing no unlock row of its own is still measured by the tests in it. */
  it('opens behind a prerequisite that is open without a row, once that one is sat', async () => {
    const { resolver, world } = build(
      reachable({
        series: [
          makeSeries({ id: 'srs_0', name: 'Foundation mocks' }),
          makeSeries({ id: 'srs_1', name: 'Advanced mocks', prerequisiteSeriesId: 'srs_0' }),
        ],
        branchConfigs: chainConfigs(['srs_0', 'srs_1']),
        seriesTests: [
          { testSeriesId: 'srs_0', testId: 'tst_0', order: 1 },
          { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
        ],
        tests: [makeTestRow({ id: 'tst_0' }), makeTestRow({ id: 'tst_1' })],
        attempts: [{ studentId: 'stu_1', testId: 'tst_0', status: ATTEMPT_STATUS.EVALUATED }],
      }),
    );

    const states = await statesOf(resolver);

    assert.equal(states.get('srs_0'), UNLOCK_STATE.UNLOCKED);
    assert.equal(states.get('srs_1'), UNLOCK_STATE.UNLOCKED);
    assert.deepEqual(
      world.unlocks.map((row) => row.testSeriesId),
      ['srs_1'],
      'only the gated series is written; the one that needs no row still has none',
    );
  });

  /** A chain advances one link per sitting: B has nothing sat the moment it opens, so C waits. */
  it('opens the next link only, leaving the one behind it waiting to be sat', async () => {
    const { resolver } = build(
      reachable({
        series: [
          makeSeries({ id: 'srs_0', name: 'A foundation' }),
          makeSeries({ id: 'srs_1', name: 'B intermediate', prerequisiteSeriesId: 'srs_0' }),
          makeSeries({ id: 'srs_2', name: 'C advanced', prerequisiteSeriesId: 'srs_1' }),
        ],
        branchConfigs: chainConfigs(['srs_0', 'srs_1', 'srs_2']),
        seriesTests: [
          { testSeriesId: 'srs_0', testId: 'tst_0', order: 1 },
          { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
          { testSeriesId: 'srs_2', testId: 'tst_2', order: 1 },
        ],
        tests: [
          makeTestRow({ id: 'tst_0' }),
          makeTestRow({ id: 'tst_1' }),
          makeTestRow({ id: 'tst_2' }),
        ],
        attempts: [{ studentId: 'stu_1', testId: 'tst_0', status: ATTEMPT_STATUS.SUBMITTED }],
      }),
    );

    const states = await statesOf(resolver);

    assert.equal(states.get('srs_0'), UNLOCK_STATE.UNLOCKED);
    assert.equal(states.get('srs_1'), UNLOCK_STATE.UNLOCKED);
    assert.equal(states.get('srs_2'), UNLOCK_STATE.LOCKED);
  });

  /** An AUTO series with nothing in front of it is open already and needs no row written. */
  it('writes nothing for an AUTO series that was never gated', async () => {
    const { resolver, world, prisma } = build(
      reachable({ series: [makeSeries({ id: 'srs_1', unlockMode: UNLOCK_MODE.AUTO })] }),
    );

    assert.equal(await stateOf(resolver), UNLOCK_STATE.UNLOCKED);
    assert.deepEqual(world.unlocks, []);
    assert.ok(!prisma.queries.includes('studentSeriesUnlock.upsert'));
  });
});

describe('UnlocksService.request', () => {
  it('files a PENDING request for a REQUEST series the student reaches', async () => {
    const { service, world } = build(reachable());

    const request = await service.request('stu_1', 'srs_1');

    assert.equal(request.status, UNLOCK_REQUEST_STATUS.PENDING);
    assert.equal(request.testSeriesId, 'srs_1');
    assert.equal(request.decidedAt, null);
    assert.equal(world.requests.length, 1);
  });

  /**
   * THE failure this prevents: asking becomes a back door around the branch gate. A series the
   * student's own centre has switched off is not theirs to ask about.
   */
  it('refuses a series the student cannot reach, and files nothing', async () => {
    const { service, world } = build(
      reachable({
        branchConfigs: [
          makeBranchConfig({ testSeriesId: 'srs_1', branchId: BRANCH, enabled: false }),
        ],
      }),
    );

    const error = await service.request('stu_1', 'srs_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
    assert.deepEqual(world.requests, []);
  });

  it('refuses a series the student reaches through some other branch’s window', async () => {
    const { service } = build(
      reachable({
        students: [makeStudent({ id: 'stu_1', currentBranchId: null, enrolledExams: [EXAM] })],
      }),
    );

    const error = await service.request('stu_1', 'srs_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  it('refuses a series that is already open to them', async () => {
    const { service, world } = build(
      reachable({
        unlocks: [
          { studentId: 'stu_1', testSeriesId: 'srs_1', unlockedAt: new Date('2026-05-01') },
        ],
      }),
    );

    const error = await service.request('stu_1', 'srs_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.deepEqual(world.requests, []);
  });

  /** An AUTO series with nothing in front of it is open already, so there is nothing to ask for. */
  it('refuses a series that is already open to the student', async () => {
    const { service } = build(
      reachable({ series: [makeSeries({ id: 'srs_1', unlockMode: UNLOCK_MODE.AUTO })] }),
    );

    const error = await service.request('stu_1', 'srs_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
  });

  /** The early-unlock path: a student may ask to skip ahead, and an admin is the one who decides. */
  it('takes an ask for an AUTO series still waiting on its prerequisite', async () => {
    const { service } = build(waitingOnPrerequisite());

    const request = await service.request('stu_1', 'srs_1');

    assert.equal(request.status, UNLOCK_REQUEST_STATUS.PENDING);
    assert.equal(request.testSeriesId, 'srs_1');
  });

  /** Without this the screen offers to ask again on every reload, and the student cannot tell. */
  it('shows on the catalog as already asked', async () => {
    const { service, resolver, events, listener } = build(waitingOnPrerequisite());

    await service.request('stu_1', 'srs_1');
    await deliverBusts(events, listener);
    const catalog = await resolver.catalog('stu_1', NOW);

    assert.equal(catalog.series[0]?.id, 'srs_1');
    assert.equal(catalog.series[0]?.unlockRequested, true);
  });

  /** THE point of the ask: approval is what gets a student past a prerequisite they have not sat. */
  it('opens it on approval, past the prerequisite it never finished', async () => {
    const { service, resolver, world, events, listener } = build(waitingOnPrerequisite());
    const request = await service.request('stu_1', 'srs_1');

    await service.decide(request.id, ADMIN, UNLOCK_REQUEST_STATUS.APPROVED, EVERY_BRANCH);
    await deliverBusts(events, listener);

    assert.ok(world.unlocks.some((row) => row.testSeriesId === 'srs_1' && row.unlockedAt !== null));
    assert.equal(await stateOf(resolver), UNLOCK_STATE.UNLOCKED);
  });

  /**
   * Deliberate: asking is not starting. A blocked student may queue up for the series they will
   * sit once the block is lifted, and the block is still what stops them starting a test.
   */
  it('lets a test-blocked student ask, and still refuses to start the test', async () => {
    const { service, resolver } = build(
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

    const request = await service.request('stu_1', 'srs_1');
    const error = await resolver.assertCanStart('stu_1', 'tst_1', NOW).catch((e: unknown) => e);

    assert.equal(request.status, UNLOCK_REQUEST_STATUS.PENDING);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.FORBIDDEN);
  });

  it('hands back the request already open rather than filing a second one', async () => {
    const { service, world } = build(reachable());
    const first = await service.request('stu_1', 'srs_1');

    const second = await service.request('stu_1', 'srs_1');

    assert.equal(second.id, first.id);
    assert.equal(world.requests.length, 1);
  });

  /**
   * The partial unique (`WHERE status='PENDING'`) is the real guard, and two taps race past the
   * read in front of it. What must not happen is a 500 landing on the student who tapped twice.
   */
  it('answers kindly when another tab won the race to file it', async () => {
    const { service, prisma, world } = build(reachable());
    prisma.onQuery = (name) => {
      if (name !== 'seriesUnlockRequest.create') return Promise.resolve();
      prisma.onQuery = null;
      world.requests.push({
        id: 'sur_other',
        studentId: 'stu_1',
        testSeriesId: 'srs_1',
        status: UNLOCK_REQUEST_STATUS.PENDING,
        requestedAt: NOW,
        decidedAt: null,
        decidedById: null,
      });
      return Promise.resolve();
    };

    const request = await service.request('stu_1', 'srs_1');

    assert.equal(request.id, 'sur_other');
    assert.equal(world.requests.length, 1);
  });
});

describe('UnlocksService.decide', () => {
  const pending = (over: FakeCatalogData = {}) =>
    build(
      reachable({
        unlockRequests: [
          {
            id: 'sur_1',
            studentId: 'stu_1',
            testSeriesId: 'srs_1',
            status: UNLOCK_REQUEST_STATUS.PENDING,
            requestedAt: NOW,
            decidedAt: null,
            decidedById: null,
          },
        ],
        ...over,
      }),
    );

  it('approving opens the series, and the catalog says so once the bust lands', async () => {
    const { service, resolver, listener, events, world } = pending();
    assert.equal(await stateOf(resolver), UNLOCK_STATE.LOCKED);

    const decided = await service.decide(
      'sur_1',
      ADMIN,
      UNLOCK_REQUEST_STATUS.APPROVED,
      EVERY_BRANCH,
    );
    await deliverBusts(events, listener);

    assert.equal(decided.status, UNLOCK_REQUEST_STATUS.APPROVED);
    assert.equal(decided.decidedById, ADMIN);
    assert.ok(decided.decidedAt);
    assert.equal(decided.testSeries.name, 'SSC CGL Tier 1 mocks');
    assert.ok(world.unlocks.some((row) => row.testSeriesId === 'srs_1' && row.unlockedAt !== null));
    assert.equal(await stateOf(resolver), UNLOCK_STATE.UNLOCKED);
  });

  it('announces the unlock AND the cache bust behind it', async () => {
    const { service, events } = pending();

    await service.decide('sur_1', ADMIN, UNLOCK_REQUEST_STATUS.APPROVED, EVERY_BRANCH);

    assert.deepEqual(events.of(DOMAIN_EVENTS.SERIES_UNLOCKED), [
      { studentId: 'stu_1', testSeriesId: 'srs_1' },
    ]);
    assert.deepEqual(events.of(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED), [{ studentId: 'stu_1' }]);
  });

  /**
   * THE failure this prevents: a grant is a REACH path and survives the branch switching the
   * series off. An unlock only ever opens something the student already reaches, so approving
   * one must leave `StudentGrant` untouched.
   */
  it('mints no grant', async () => {
    const { service, world } = pending();

    await service.decide('sur_1', ADMIN, UNLOCK_REQUEST_STATUS.APPROVED, EVERY_BRANCH);

    assert.deepEqual(world.grants, []);
  });

  /**
   * THE failure this prevents: a row with no time on it is a LOCKED row, so an approval that only
   * upserts reports APPROVED, tells the student, and leaves the series shut.
   */
  it('puts a time on a row that was left without one', async () => {
    const { service, resolver, listener, events, world } = pending({
      unlocks: [{ studentId: 'stu_1', testSeriesId: 'srs_1', unlockedAt: null }],
    });
    assert.equal(await stateOf(resolver), UNLOCK_STATE.LOCKED);

    await service.decide('sur_1', ADMIN, UNLOCK_REQUEST_STATUS.APPROVED, EVERY_BRANCH);
    await deliverBusts(events, listener);

    assert.equal(world.unlocks.length, 1);
    assert.ok(world.unlocks[0]?.unlockedAt);
    assert.equal(await stateOf(resolver), UNLOCK_STATE.UNLOCKED);
  });

  /** One series, one telling: the student must not be announced the same unlock twice. */
  it('says nothing new when the series had already opened itself', async () => {
    const { service, resolver, listener, events } = build(
      reachable({
        series: [
          makeSeries({ id: 'srs_0', name: 'Foundation mocks' }),
          makeSeries({ id: 'srs_1', name: 'Advanced mocks', prerequisiteSeriesId: 'srs_0' }),
        ],
        branchConfigs: chainConfigs(['srs_0', 'srs_1']),
        unlockRequests: [
          {
            id: 'sur_1',
            studentId: 'stu_1',
            testSeriesId: 'srs_1',
            status: UNLOCK_REQUEST_STATUS.PENDING,
            requestedAt: NOW,
            decidedAt: null,
            decidedById: null,
          },
        ],
      }),
    );
    await resolver.catalog('stu_1', NOW);
    await deliverBusts(events, listener);

    const decided = await service.decide(
      'sur_1',
      ADMIN,
      UNLOCK_REQUEST_STATUS.APPROVED,
      EVERY_BRANCH,
    );

    assert.equal(decided.status, UNLOCK_REQUEST_STATUS.APPROVED);
    assert.deepEqual(events.of(DOMAIN_EVENTS.SERIES_UNLOCKED), [
      { studentId: 'stu_1', testSeriesId: 'srs_1' },
    ]);
  });

  /**
   * THE failure this prevents: an unlock read as a REACH path. It only ever opens something the
   * branch already lets through, so the day the branch switches off, the row grants nothing.
   */
  it('opens nothing once the branch switches the series off', async () => {
    const branchConfig = makeBranchConfig({ testSeriesId: 'srs_1', branchId: BRANCH });
    const { service, resolver, listener, events, world } = pending({
      branchConfigs: [branchConfig],
    });

    await service.decide('sur_1', ADMIN, UNLOCK_REQUEST_STATUS.APPROVED, EVERY_BRANCH);
    branchConfig.enabled = false;
    await deliverBusts(events, listener);

    assert.deepEqual((await resolver.catalog('stu_1', NOW)).series, []);
    assert.equal(world.unlocks.length, 1, 'the row survives, inert');
  });

  it('rejecting records the decision and opens nothing', async () => {
    const { service, resolver, world, events } = pending();

    const decided = await service.decide(
      'sur_1',
      ADMIN,
      UNLOCK_REQUEST_STATUS.REJECTED,
      EVERY_BRANCH,
    );

    assert.equal(decided.status, UNLOCK_REQUEST_STATUS.REJECTED);
    assert.equal(decided.decidedById, ADMIN);
    assert.deepEqual(world.unlocks, []);
    assert.deepEqual(events.of(DOMAIN_EVENTS.SERIES_UNLOCKED), []);
    assert.equal(await stateOf(resolver), UNLOCK_STATE.LOCKED);
  });

  /** Two admins open the same queue. The second one must be told, not silently overrule the first. */
  it('refuses to decide a request somebody already answered', async () => {
    const { service, world } = pending();
    await service.decide('sur_1', ADMIN, UNLOCK_REQUEST_STATUS.REJECTED, EVERY_BRANCH);

    const error = await service
      .decide('sur_1', 'adm_2', UNLOCK_REQUEST_STATUS.APPROVED, EVERY_BRANCH)
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.equal(world.requests[0]?.status, UNLOCK_REQUEST_STATUS.REJECTED);
    assert.deepEqual(world.unlocks, []);
  });

  it('refuses a request that does not exist', async () => {
    const { service } = pending();

    const error = await service
      .decide('sur_gone', ADMIN, UNLOCK_REQUEST_STATUS.APPROVED, EVERY_BRANCH)
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });
});

describe('UnlocksService.listRequests', () => {
  const queue = () =>
    build(
      reachable({
        students: [
          makeStudent({ id: 'stu_1', fullName: 'Ravi Kumar', currentBranchId: BRANCH }),
          makeStudent({ id: 'stu_2', mobile: '9000000002', currentBranchId: BRANCH }),
        ],
        unlockRequests: [
          {
            id: 'sur_old',
            studentId: 'stu_1',
            testSeriesId: 'srs_1',
            status: UNLOCK_REQUEST_STATUS.APPROVED,
            requestedAt: new Date('2026-05-01T00:00:00.000Z'),
            decidedAt: new Date('2026-05-02T00:00:00.000Z'),
            decidedById: ADMIN,
          },
          {
            id: 'sur_new',
            studentId: 'stu_2',
            testSeriesId: 'srs_1',
            status: UNLOCK_REQUEST_STATUS.PENDING,
            requestedAt: NOW,
            decidedAt: null,
            decidedById: null,
          },
        ],
      }),
    );

  it('reads newest first, naming the student and the series rather than two ids', async () => {
    const { service } = queue();

    const page = await service.listRequests({ page: 1, pageSize: 20 }, EVERY_BRANCH);

    assert.deepEqual(
      page.items.map((row) => row.id),
      ['sur_new', 'sur_old'],
    );
    assert.equal(page.total, 2);
    assert.equal(page.items[1]?.student.fullName, 'Ravi Kumar');
    assert.equal(page.items[1]?.testSeries.name, 'SSC CGL Tier 1 mocks');
  });

  it('narrows to what is still waiting on somebody', async () => {
    const { service } = queue();

    const page = await service.listRequests(
      {
        page: 1,
        pageSize: 20,
        status: UNLOCK_REQUEST_STATUS.PENDING,
      },
      EVERY_BRANCH,
    );

    assert.deepEqual(
      page.items.map((row) => row.id),
      ['sur_new'],
    );
    assert.equal(page.total, 1);
  });

  it('pages, so a queue that grows does not arrive in one response', async () => {
    const { service } = queue();

    const page = await service.listRequests({ page: 2, pageSize: 1 }, EVERY_BRANCH);

    assert.deepEqual(
      page.items.map((row) => row.id),
      ['sur_old'],
    );
    assert.equal(page.total, 2);
  });
});

/** Asking for a FREE series nobody reaches: the one way in for a student outside the institute. */

const FAMILIES = [EXAM_COURSE.SSC, EXAM_COURSE.RRB, EXAM_COURSE.BANKING] as const;

/** Three FREE series, one per course, and a student who reaches none of them. */
function outsider(over: FakeCatalogData = {}): FakeCatalogData {
  return {
    students: [
      makeStudent({
        id: 'stu_1',
        currentBranchId: null,
        enrolledExams: [],
        enrolledCourses: [],
        studentType: STUDENT_TYPE.NON_IACE,
      }),
    ],
    exams: FAMILIES.map((course) =>
      makeExam({ id: `exam_${course}`, course, code: course, name: course }),
    ),
    stages: FAMILIES.map((course) =>
      makeExamStage({ id: `stage_${course}`, examId: `exam_${course}`, stageKey: `${course}_T1` }),
    ),
    series: FAMILIES.map((course) =>
      makeSeries({
        id: `srs_${course}`,
        examStageId: `stage_${course}`,
        kind: TEST_SERIES_KIND.FREE,
      }),
    ),
    ...over,
  };
}

const grantOf = (testSeriesId: string): FakeGrantRowAccess => ({
  studentId: 'stu_1',
  testSeriesId,
  createdById: ADMIN,
  createdAt: NOW,
});

describe('asking for a FREE series nobody reaches', () => {
  it('takes the ask, though the student reaches nothing at all', async () => {
    const { service, resolver } = build(outsider());
    assert.deepEqual((await resolver.catalog('stu_1', NOW)).series, []);

    const request = await service.request('stu_1', `srs_${EXAM_COURSE.SSC}`);

    assert.equal(request.status, UNLOCK_REQUEST_STATUS.PENDING);
  });

  /** An event intake names its candidates; putting a hand up is not being named. */
  it('refuses an EVENT series', async () => {
    const { service } = build(
      outsider({
        series: [
          makeSeries({
            id: 'srs_scholar',
            examStageId: `stage_${EXAM_COURSE.SSC}`,
            kind: TEST_SERIES_KIND.EVENT,
          }),
        ],
      }),
    );

    await assert.rejects(
      () => service.request('stu_1', 'srs_scholar'),
      (error: AppException) => error.code === ErrorCodes.NOT_FOUND,
    );
  });

  it('refuses a STANDARD series', async () => {
    const { service } = build(
      outsider({
        series: [
          makeSeries({
            id: 'srs_std',
            examStageId: `stage_${EXAM_COURSE.SSC}`,
            kind: TEST_SERIES_KIND.STANDARD,
          }),
        ],
      }),
    );

    await assert.rejects(
      () => service.request('stu_1', 'srs_std'),
      (error: AppException) => error.code === ErrorCodes.NOT_FOUND,
    );
  });

  it('approving writes a GRANT, and the series is theirs on the next read', async () => {
    const { service, resolver, listener, events, world } = build(outsider());
    const request = await service.request('stu_1', `srs_${EXAM_COURSE.SSC}`);

    await service.decide(request.id, ADMIN, UNLOCK_REQUEST_STATUS.APPROVED, EVERY_BRANCH);
    await deliverBusts(events, listener);

    assert.deepEqual(
      world.grants.map((grant) => grant.testSeriesId),
      [`srs_${EXAM_COURSE.SSC}`],
    );
    assert.deepEqual(
      (await resolver.catalog('stu_1', NOW)).series.map((series) => series.id),
      [`srs_${EXAM_COURSE.SSC}`],
    );
  });

  it('refuses a third exam', async () => {
    const { service } = build(
      outsider({
        grants: [grantOf(`srs_${EXAM_COURSE.SSC}`), grantOf(`srs_${EXAM_COURSE.RRB}`)],
      }),
    );

    await assert.rejects(
      () => service.request('stu_1', `srs_${EXAM_COURSE.BANKING}`),
      (error: AppException) => error.code === ErrorCodes.VALIDATION_ERROR,
    );
  });

  /** Otherwise five asks queue across five exams and every one of them is approvable. */
  it('counts an ask still waiting toward the cap', async () => {
    const { service } = build(outsider({ grants: [grantOf(`srs_${EXAM_COURSE.SSC}`)] }));
    await service.request('stu_1', `srs_${EXAM_COURSE.RRB}`);

    await assert.rejects(
      () => service.request('stu_1', `srs_${EXAM_COURSE.BANKING}`),
      (error: AppException) => error.code === ErrorCodes.VALIDATION_ERROR,
    );
  });

  /** The whole change: SSC holds CGL, CHSL and MTS, and two of them are two, not one. */
  it('counts two exams inside ONE course as two', async () => {
    const oneCourse: FakeCatalogData = {
      exams: [
        makeExam({ id: 'exam_cgl', course: EXAM_COURSE.SSC, code: 'SSC CGL', name: 'SSC CGL' }),
        makeExam({ id: 'exam_chsl', course: EXAM_COURSE.SSC, code: 'SSC CHSL', name: 'SSC CHSL' }),
        makeExam({ id: 'exam_mts', course: EXAM_COURSE.SSC, code: 'SSC MTS', name: 'SSC MTS' }),
      ],
      stages: [
        makeExamStage({ id: 'stage_cgl', examId: 'exam_cgl', stageKey: 'CGL_T1' }),
        makeExamStage({ id: 'stage_chsl', examId: 'exam_chsl', stageKey: 'CHSL_T1' }),
        makeExamStage({ id: 'stage_mts', examId: 'exam_mts', stageKey: 'MTS_T1' }),
      ],
      series: ['cgl', 'chsl', 'mts'].map((exam) =>
        makeSeries({
          id: `srs_${exam}`,
          examStageId: `stage_${exam}`,
          kind: TEST_SERIES_KIND.FREE,
        }),
      ),
      grants: [grantOf('srs_cgl'), grantOf('srs_chsl')],
    };
    const { service } = build(outsider(oneCourse));

    await assert.rejects(
      () => service.request('stu_1', 'srs_mts'),
      (error: AppException) => error.code === ErrorCodes.VALIDATION_ERROR,
    );
  });

  it('lets a second series on an exam they already hold through', async () => {
    const { service } = build(
      outsider({
        grants: [grantOf(`srs_${EXAM_COURSE.SSC}`), grantOf(`srs_${EXAM_COURSE.RRB}`)],
        series: [
          ...FAMILIES.map((course) =>
            makeSeries({
              id: `srs_${course}`,
              examStageId: `stage_${course}`,
              kind: TEST_SERIES_KIND.FREE,
            }),
          ),
          makeSeries({
            id: 'srs_ssc_two',
            examStageId: `stage_${EXAM_COURSE.SSC}`,
            kind: TEST_SERIES_KIND.FREE,
          }),
        ],
      }),
    );

    const request = await service.request('stu_1', 'srs_ssc_two');

    assert.equal(request.status, UNLOCK_REQUEST_STATUS.PENDING);
  });
});

describe('UnlocksService — the branches the admin deciding may reach', () => {
  const held = { all: false, branchIds: [BRANCH] } as const;
  const elsewhere = { all: false, branchIds: ['br_elsewhere'] } as const;

  /** Whose request it is decides who may see it: a student belongs to exactly one branch. */
  it("lists only the requests of students at the admin's branches", async () => {
    const { service } = build(reachable());
    await service.request('stu_1', 'srs_1');

    const mine = await service.listRequests({ page: 1, pageSize: 20 } as never, held);
    const theirs = await service.listRequests({ page: 1, pageSize: 20 } as never, elsewhere);

    assert.equal(mine.total, 1);
    // The count comes off the same where as the rows, or the pager promises unreachable pages.
    assert.equal(theirs.total, 0);
    assert.equal(theirs.items.length, 0);
  });

  /** The failure this prevents: approving series access for somebody else's student. */
  it('refuses to decide a request from a student at another branch', async () => {
    const { service } = build(reachable());
    const request = await service.request('stu_1', 'srs_1');

    const error = await service
      .decide(request.id, 'adm_1', UNLOCK_REQUEST_STATUS.APPROVED, elsewhere)
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  it('decides a request from a student at their own branch', async () => {
    const { service } = build(reachable());
    const request = await service.request('stu_1', 'srs_1');

    const decided = await service.decide(request.id, 'adm_1', UNLOCK_REQUEST_STATUS.APPROVED, held);

    assert.equal(decided.status, UNLOCK_REQUEST_STATUS.APPROVED);
  });

  it('narrows an unnarrowed admin to the one branch they asked for', async () => {
    const { service } = build(reachable());
    await service.request('stu_1', 'srs_1');

    const here = await service.listRequests(
      { page: 1, pageSize: 20, branchId: BRANCH } as never,
      EVERY_BRANCH,
    );
    const there = await service.listRequests(
      { page: 1, pageSize: 20, branchId: 'br_other' } as never,
      EVERY_BRANCH,
    );

    assert.equal(here.total, 1);
    assert.equal(there.total, 0);
  });

  /** The failure this prevents: a filter that WIDENS a scope instead of narrowing it. */
  it("answers nothing when the branch asked for is outside the admin's own", async () => {
    const { service } = build(reachable());
    await service.request('stu_1', 'srs_1');

    const page = await service.listRequests(
      { page: 1, pageSize: 20, branchId: BRANCH } as never,
      elsewhere,
    );

    assert.equal(page.total, 0);
    assert.equal(page.items.length, 0);
  });
});
