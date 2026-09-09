import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  EXAM_COURSE,
  ErrorCodes,
  type StudentCatalog,
  TEST_SERIES_KIND,
  TEST_SERIES_KINDS,
  TEST_STATUS,
} from '@iace/contracts';
import { AccessResolverService } from '../src/access/access-resolver.service';
import { AccessCacheListener } from '../src/access/access-cache.listener';
import {
  FakeCatalogPrisma,
  FakeRedis,
  type FakeCatalogData,
  type FakeGrantRowAccess,
  type FakeProgramUnlockRow,
  type FakeTestRow,
  makeSeries,
  makeStudent,
  makeTestRow,
} from './support/fakes';

/** The access resolver's truth table: a series is reached by its KIND, or by a grant, and only while it is switched on. */

const BRANCH = 'br_1';
const COURSE = EXAM_COURSE.SSC;
const PROGRAM = 'SSC CGL FOUNDATION';
const EVENT = 'evt_1';
const NOW = new Date('2026-06-01T00:00:00.000Z');
const HOUR_SEC = 60 * 60;

function build(data: FakeCatalogData) {
  const prisma = new FakeCatalogPrisma(data);
  const redis = new FakeRedis();
  return {
    prisma,
    redis,
    resolver: new AccessResolverService(prisma.asService(), redis.asService()),
  };
}

/** One test inside the one series every fixture below builds on. */
const testIn = (id: string, seriesOrder: number, over: Partial<FakeTestRow> = {}) =>
  makeTestRow({ id, testSeriesId: 'srs_1', seriesOrder, ...over });

const grantOf = (testSeriesId: string): FakeGrantRowAccess => ({
  studentId: 'stu_1',
  testSeriesId,
  createdById: 'adm_1',
  createdAt: NOW,
});

/** A student at a branch on a course, one STANDARD series that branch runs, one ACTIVE test in it. */
function reachable(over: FakeCatalogData = {}): FakeCatalogData {
  return {
    students: [makeStudent({ id: 'stu_1', currentBranchId: BRANCH, enrolledCourses: [COURSE] })],
    series: [makeSeries({ id: 'srs_1', branchIds: [BRANCH] })],
    tests: [testIn('tst_1', 1)],
    ...over,
  };
}

const seriesIds = (catalog: StudentCatalog) => catalog.series.map((series) => series.id);

const reached = async (data: FakeCatalogData) =>
  seriesIds(await build(data).resolver.catalog('stu_1', NOW));

describe('AccessResolverService — how a series is reached', () => {
  it('reaches a STANDARD series only at a branch that runs it', async () => {
    assert.deepEqual(await reached(reachable()), ['srs_1']);
    assert.deepEqual(
      await reached(reachable({ series: [makeSeries({ id: 'srs_1', branchIds: ['br_9'] })] })),
      [],
    );
  });

  /** The mirror of the branch arm: the centre runs it, but this student is not on that course. */
  it('gives a STANDARD series to nobody outside its course', async () => {
    const elsewhere = reachable({
      students: [
        makeStudent({
          id: 'stu_1',
          currentBranchId: BRANCH,
          enrolledCourses: [EXAM_COURSE.BANKING],
        }),
      ],
    });

    assert.deepEqual(await reached(elsewhere), []);
  });

  it('gives a student with no branch nothing on a course match', async () => {
    const nowhere = reachable({
      students: [makeStudent({ id: 'stu_1', currentBranchId: null, enrolledCourses: [COURSE] })],
    });

    assert.deepEqual(await reached(nowhere), []);
  });

  /** FREE is the platform's shop window: no branch, no course, no program, and still reached. */
  it('reaches a FREE series with no enrolment at all', async () => {
    const outsider = reachable({
      students: [makeStudent({ id: 'stu_1', currentBranchId: null, enrolledCourses: [] })],
      series: [makeSeries({ id: 'srs_1', kind: TEST_SERIES_KIND.FREE })],
    });

    assert.deepEqual(await reached(outsider), ['srs_1']);
  });

  /** THE failure this prevents: a PROGRAM series opened on a course match hands a paid cohort's papers to everyone on that exam. */
  it('reaches a PROGRAM series only while the student carries the program', async () => {
    const forProgram = (programs: string[]) =>
      reachable({
        students: [
          makeStudent({
            id: 'stu_1',
            currentBranchId: BRANCH,
            enrolledCourses: [COURSE],
            programs,
          }),
        ],
        series: [
          makeSeries({
            id: 'srs_1',
            kind: TEST_SERIES_KIND.PROGRAM,
            programCode: PROGRAM,
            branchIds: [BRANCH],
          }),
        ],
      });

    assert.deepEqual(await reached(forProgram([PROGRAM])), ['srs_1']);
    assert.deepEqual(await reached(forProgram(['SSC CHSL FOUNDATION'])), []);
    assert.deepEqual(await reached(forProgram([])), []);
  });

  /** An event intake names its sitters; being at the branch it runs at is not being named. */
  it('reaches an EVENT series only as a candidate on its event', async () => {
    const forCandidate = (studentId: string) =>
      reachable({
        series: [
          makeSeries({
            id: 'srs_1',
            kind: TEST_SERIES_KIND.EVENT,
            eventId: EVENT,
            branchIds: [BRANCH],
          }),
        ],
        eventCandidates: [{ eventId: EVENT, studentId }],
      });

    assert.deepEqual(await reached(forCandidate('stu_1')), ['srs_1']);
    assert.deepEqual(await reached(forCandidate('stu_2')), []);
  });

  it('lets a grant override every kind', async () => {
    const granted = (kind: (typeof TEST_SERIES_KINDS)[number]) =>
      reachable({
        students: [makeStudent({ id: 'stu_1', currentBranchId: null, enrolledCourses: [] })],
        series: [makeSeries({ id: 'srs_1', kind, programCode: PROGRAM, eventId: EVENT })],
        grants: [grantOf('srs_1')],
      });

    for (const kind of TEST_SERIES_KINDS) {
      assert.deepEqual(await reached(granted(kind)), ['srs_1'], kind);
    }
  });

  /** THE failure this prevents: a series pulled out of service still reaching its grantees. */
  it('reaches nothing in a series nobody switched on', async () => {
    const off = reachable({
      series: [makeSeries({ id: 'srs_1', branchIds: [BRANCH], isEnabled: false })],
      grants: [grantOf('srs_1')],
    });

    assert.deepEqual(await reached(off), []);
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
            enrolledCourses: [COURSE],
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
        tests: [
          testIn('tst_1', 1),
          testIn('tst_2', 2, { status: TEST_STATUS.DRAFT }),
          testIn('tst_3', 3, { status: TEST_STATUS.INACTIVE }),
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
            enrolledCourses: [COURSE],
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
  const testAt = async (opensAt: Date | null) =>
    (
      await build(reachable({ tests: [testIn('tst_1', 1, { opensAt })] })).resolver.catalog(
        'stu_1',
        NOW,
      )
    ).series[0]?.tests[0];

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
    assert.equal(test?.opensAt, null);
  });

  /** The guarantee the model rests on: an opened test stays startable however long ago it opened. */
  it('stays startable long after it opened, because nothing shuts it', async () => {
    const test = await testAt(new Date('2020-01-01T00:00:00.000Z'));

    assert.equal(test?.canStart, true);
  });
});

describe('AccessResolverService — when a test opens for one program', () => {
  const OPENS = new Date('2026-07-01T00:00:00.000Z');
  const EARLY = new Date('2026-05-01T00:00:00.000Z');
  const EARLIER = new Date('2026-04-01T00:00:00.000Z');
  const OTHER_PROGRAM = 'SSC CHSL FOUNDATION';

  const seenBy = async (programs: string[], programUnlocks: FakeProgramUnlockRow[]) =>
    (
      await build(
        reachable({
          students: [
            makeStudent({
              id: 'stu_1',
              currentBranchId: BRANCH,
              enrolledCourses: [COURSE],
              programs,
            }),
          ],
          tests: [testIn('tst_1', 1, { opensAt: OPENS, lateEntrySec: HOUR_SEC })],
          programUnlocks,
        }),
      ).resolver.catalog('stu_1', NOW)
    ).series[0]?.tests[0];

  const early: FakeProgramUnlockRow = { testId: 'tst_1', programCode: PROGRAM, opensAt: EARLY };
  const earlier: FakeProgramUnlockRow = {
    testId: 'tst_1',
    programCode: OTHER_PROGRAM,
    opensAt: EARLIER,
  };

  /** THE failure this prevents: one cohort's early sitting opening the paper for everybody. */
  it('opens a test early for a program holder and for nobody else', async () => {
    const holder = await seenBy([PROGRAM], [early]);
    const outsider = await seenBy([], [early]);

    assert.deepEqual([holder?.opensAt, holder?.canStart], [EARLY.toISOString(), true]);
    assert.deepEqual([outsider?.opensAt, outsider?.canStart], [OPENS.toISOString(), false]);
  });

  it('takes the earliest opening when the student holds two programs', async () => {
    const both = await seenBy([PROGRAM, OTHER_PROGRAM], [early, earlier]);

    assert.equal(both?.opensAt, EARLIER.toISOString());
  });
});

describe('AccessResolverService.testSchedule', () => {
  const scheduleOf = (over: Partial<FakeTestRow>) =>
    build(reachable({ tests: [makeTestRow({ id: 'tst_1', ...over })] })).resolver.testSchedule(
      'tst_1',
    );

  it('carries the allowance the test grants every sitting', async () => {
    const schedule = await scheduleOf({
      testSeriesId: 'srs_1',
      opensAt: new Date('2026-06-01T09:00:00.000Z'),
      extraTimeSec: 300,
    });

    assert.deepEqual(schedule, { extraTimeSec: 300 });
  });

  it('reads no allowance as none, never as undefined', async () => {
    assert.deepEqual(await scheduleOf({ testSeriesId: 'srs_1' }), { extraTimeSec: 0 });
  });
});

describe('AccessResolverService — what the paper is', () => {
  /** THE failure this prevents: an unstartable test must not blank out what the paper itself is. */
  it('reports duration, questions and marks though it cannot be started yet', async () => {
    const { resolver } = build(
      reachable({
        tests: [
          testIn('tst_1', 1, {
            opensAt: new Date('2027-05-01T00:00:00.000Z'),
            durationSec: 5400,
            totalQuestions: 90,
            totalMarks: 180,
          }),
        ],
      }),
    );

    const test = (await resolver.catalog('stu_1', NOW)).series[0]?.tests[0];

    assert.equal(test?.canStart, false);
    assert.deepEqual([test?.durationSec, test?.totalQuestions, test?.totalMarks], [5400, 90, 180]);
  });
});

describe('AccessResolverService — the order the catalog comes back in', () => {
  /** Two series can share a name; without the id tiebreak they swap places between reads. */
  it('breaks a tie on id, so the same catalog reads the same way twice', async () => {
    const both = reachable({
      series: [
        makeSeries({ id: 'srs_b', name: 'Mock series', branchIds: [BRANCH] }),
        makeSeries({ id: 'srs_a', name: 'Mock series', branchIds: [BRANCH] }),
      ],
    });

    assert.deepEqual(await reached(both), ['srs_a', 'srs_b']);
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
      reachable({ series: [makeSeries({ id: 'srs_1', branchIds: ['br_9'] })] }),
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
    const student = makeStudent({
      id: 'stu_1',
      currentBranchId: BRANCH,
      enrolledCourses: [COURSE],
    });
    const { resolver } = build(reachable({ students: [student] }));
    await resolver.assertCanStart('stu_1', 'tst_1', NOW);

    student.isTestBlocked = true;

    const error = await resolver.assertCanStart('stu_1', 'tst_1', NOW).catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.FORBIDDEN);
  });

  it('refuses the moment the student is deactivated, on a cache entry nothing busted', async () => {
    const student = makeStudent({
      id: 'stu_1',
      currentBranchId: BRANCH,
      enrolledCourses: [COURSE],
    });
    const { resolver } = build(reachable({ students: [student] }));
    await resolver.assertCanStart('stu_1', 'tst_1', NOW);

    student.isActive = false;

    const error = await resolver.assertCanStart('stu_1', 'tst_1', NOW).catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.FORBIDDEN);
  });
});

describe('AccessResolverService — the read path', () => {
  /** THE failure this prevents: a catalog GET that opens a series is a write on the hot read path. */
  it('reads a catalog without writing anything', async () => {
    const { resolver, prisma } = build(reachable());

    await resolver.catalog('stu_1', NOW);

    assert.deepEqual(prisma.writes, []);
  });
});

describe('AccessResolverService — the cache', () => {
  const twoStudents = (over: FakeCatalogData = {}) =>
    reachable({
      students: [
        makeStudent({ id: 'stu_1', currentBranchId: BRANCH, enrolledCourses: [COURSE] }),
        makeStudent({ id: 'stu_2', currentBranchId: BRANCH, enrolledCourses: [COURSE] }),
      ],
      ...over,
    });

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
    const series = makeSeries({ id: 'srs_1', branchIds: [BRANCH] });
    const { resolver, prisma } = build(reachable({ series: [series] }));
    prisma.onQuery = async (name) => {
      if (name !== 'testSeries.findMany') return;
      prisma.onQuery = null;
      await resolver.invalidateStudent('stu_1');
    };

    assert.deepEqual(seriesIds(await resolver.catalog('stu_1', NOW)), ['srs_1']);
    series.isEnabled = false;

    assert.deepEqual(seriesIds(await resolver.catalog('stu_1', NOW)), []);
  });

  it('leaves every other student’s entry alone when one student is busted', async () => {
    const { resolver, prisma } = build(twoStudents());
    await resolver.catalog('stu_1', NOW);
    await resolver.catalog('stu_2', NOW);
    const afterBoth = prisma.queries.length;

    await resolver.invalidateStudent('stu_1');
    await resolver.catalog('stu_2', NOW);

    assert.equal(prisma.queries.length, afterBoth);
  });

  /** A series-wide change is one INCR, not a scan: every student falls out of cache at once. */
  it('recomputes for everyone when the catalog itself changes', async () => {
    const { resolver, prisma } = build(twoStudents());
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

  /** WHY the window is not cached: one entry must answer UPCOMING before the opening time and ACTIVE after it, with no bust in between. */
  it('crosses an opening time on a cache entry that never changed', async () => {
    const opensAt = new Date('2026-06-15T00:00:00.000Z');
    const { resolver, prisma } = build(reachable({ tests: [testIn('tst_1', 1, { opensAt })] }));

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
          makeStudent({ id: 'stu_1', currentBranchId: BRANCH, enrolledCourses: [COURSE] }),
          makeStudent({ id: 'stu_2', currentBranchId: BRANCH, enrolledCourses: [COURSE] }),
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
    await assert.doesNotReject(() => listener.onCatalogChanged({ testSeriesId: 'srs_1' }));
  });
});

describe('AccessResolverService — a series that unlocks in order', () => {
  const inOrder = (attempts: { studentId: string; testId: string; status: string }[] = []) =>
    build(
      reachable({
        series: [makeSeries({ id: 'srs_1', branchIds: [BRANCH], sequentialTests: true })],
        tests: [testIn('tst_1', 1), testIn('tst_2', 2), testIn('tst_3', 3)],
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
    const open = build(reachable({ tests: [testIn('tst_1', 1), testIn('tst_2', 2)] })).resolver;

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
