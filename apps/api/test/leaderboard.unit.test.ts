import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ATTEMPT_STATUS } from '@iace/contracts';
import {
  LEADERBOARD_MAX_TIME_SEC,
  bandOf,
  compositeScore,
  marksFloor,
  percentileOf,
  timeTakenSec,
} from '../src/attempts/leaderboard-score';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import { redisKeys } from '../src/redis/redis.keys';
import {
  FakeQueue,
  FakeRedis,
  FakeScoringPrisma,
  makeAttempt,
  rowAt,
  type FakeAttemptRow,
} from './support/fakes';

// --------------------------------------------------------------------------- the packing
// ---------------------------------------------------------------------------

describe('compositeScore — marks first, then speed', () => {
  it('puts more marks above fewer, however slowly they were earned', () => {
    const slowAndRight = compositeScore(80, LEADERBOARD_MAX_TIME_SEC);
    const fastAndWorse = compositeScore(79.99, 0);

    assert.ok(slowAndRight > fastAndWorse);
  });

  it('breaks a tie on equal marks by who finished sooner', () => {
    assert.ok(compositeScore(60, 1200) > compositeScore(60, 1201));
  });

  it('keeps a negative total below every positive one', () => {
    assert.ok(compositeScore(-2.5, 0) < compositeScore(0, LEADERBOARD_MAX_TIME_SEC));
  });

  it('stays an exact integer, so no two neighbours collapse into one double', () => {
    assert.ok(Number.isSafeInteger(compositeScore(1200, 0)));
    assert.notEqual(compositeScore(60.01, 600), compositeScore(60, 600));
  });

  it('never lets an over-long sitting reach into the marks below it', () => {
    const forever = compositeScore(40, LEADERBOARD_MAX_TIME_SEC * 5);

    assert.equal(forever, marksFloor(40));
    assert.ok(forever > compositeScore(39.99, 0));
  });
});

describe('timeTakenSec', () => {
  const startedAt = new Date('2026-09-01T05:00:00.000Z');

  it('measures the sitting from start to submit', () => {
    assert.equal(timeTakenSec(startedAt, new Date('2026-09-01T05:20:00.000Z')), 1200);
  });

  it('treats a sitting nobody submitted as having taken everything there was', () => {
    assert.equal(timeTakenSec(startedAt, null), LEADERBOARD_MAX_TIME_SEC);
  });

  it('refuses to make a clock run backwards into a negative advantage', () => {
    assert.equal(timeTakenSec(startedAt, new Date('2026-09-01T04:59:00.000Z')), 0);
  });
});

describe('bandOf — the marks a composite belongs to', () => {
  it('finds the same floor whatever the sitting took, at both ends of the clock', () => {
    assert.equal(bandOf(compositeScore(60, 0)).floor, marksFloor(60));
    assert.equal(bandOf(compositeScore(60, LEADERBOARD_MAX_TIME_SEC)).floor, marksFloor(60));
  });

  it('does the same for a total driven negative by negative marking', () => {
    assert.equal(bandOf(compositeScore(-2.5, 0)).floor, marksFloor(-2.5));
    assert.equal(bandOf(compositeScore(-2.5, 900)).floor, marksFloor(-2.5));
  });

  it('holds every composite on those marks and nothing on the marks either side', () => {
    const band = bandOf(compositeScore(60, 900));

    assert.ok(compositeScore(60, LEADERBOARD_MAX_TIME_SEC) >= band.floor);
    assert.ok(compositeScore(60, 0) <= band.ceiling);
    assert.ok(compositeScore(60.01, LEADERBOARD_MAX_TIME_SEC) > band.ceiling);
    assert.ok(compositeScore(59.99, 0) < band.floor);
  });
});

describe('percentileOf — a tie counts half', () => {
  it('puts a clear topper near the top and a clear last near the bottom', () => {
    assert.equal(percentileOf(199, 1, 200), 99.75);
    assert.equal(percentileOf(0, 1, 200), 0.25);
    assert.equal(percentileOf(100, 1, 200), 50.25);
  });

  it('does not read as a failure when a whole cohort scores the same', () => {
    assert.equal(percentileOf(0, 500, 500), 50);
  });

  it('reads a cohort of one as the top of its own field rather than its middle', () => {
    assert.equal(percentileOf(0, 1, 1), 100);
  });

  it('cannot pass 100 when two reads of a moving board disagree', () => {
    assert.equal(percentileOf(4002, 1, 4000), 100);
  });

  it('rounds to the two places the column can hold', () => {
    assert.equal(percentileOf(2, 1, 3), 83.33);
  });
});

// --------------------------------------------------------------------------- the board
// ---------------------------------------------------------------------------

const TEST_ID = 'tst_1';
const STARTED = new Date('2026-09-01T05:00:00.000Z');

function sat(id: string, marks: number, minutes: number, over: Partial<FakeAttemptRow> = {}) {
  return makeAttempt({
    id,
    testId: TEST_ID,
    studentId: `stu_${id}`,
    status: ATTEMPT_STATUS.EVALUATED,
    score: marks,
    startedAt: STARTED,
    submittedAt: new Date(STARTED.getTime() + minutes * 60_000),
    ...over,
  });
}

function board(attempts: FakeAttemptRow[]) {
  const prisma = new FakeScoringPrisma(attempts, []);
  const redis = new FakeRedis();
  const rebuilds = new FakeQueue();
  return {
    prisma,
    redis,
    rebuilds,
    leaderboard: new LeaderboardService(prisma.asService(), redis.asService(), rebuilds.asQueue()),
  };
}

describe('LeaderboardService', () => {
  it('ranks by marks, and settles equal marks on the faster sitting', async () => {
    const rows = [sat('att_slow', 60, 25), sat('att_fast', 60, 20), sat('att_top', 72, 30)];
    const { redis, leaderboard } = board(rows);

    for (const row of rows) await leaderboard.record(row);

    assert.deepEqual(redis.descending(redisKeys.testLeaderboard(TEST_ID)), [
      'att_top',
      'att_fast',
      'att_slow',
    ]);
  });

  it('reports a rank and a percentile a hand count agrees with', async () => {
    const rows = [
      sat('att_a', 90, 20),
      sat('att_b', 70, 20),
      sat('att_c', 50, 20),
      sat('att_d', 30, 20),
    ];
    const { leaderboard } = board(rows);
    for (const row of rows) await leaderboard.record(row);

    const top = await leaderboard.standing(TEST_ID, 'att_a');
    const third = await leaderboard.standing(TEST_ID, 'att_c');

    assert.deepEqual(top, { rank: 1, percentile: 87.5, cohortSize: 4 });
    assert.deepEqual(third, { rank: 3, percentile: 37.5, cohortSize: 4 });
  });

  it('gives two students on the same marks the same percentile, whatever their ranks', async () => {
    const rows = [
      sat('att_a', 90, 10),
      sat('att_b', 60, 15),
      sat('att_c', 60, 25),
      sat('att_d', 20, 10),
    ];
    const { leaderboard } = board(rows);
    for (const row of rows) await leaderboard.record(row);

    const quicker = await leaderboard.standing(TEST_ID, 'att_b');
    const slower = await leaderboard.standing(TEST_ID, 'att_c');

    assert.equal(quicker?.rank, 2);
    assert.equal(slower?.rank, 3);
    assert.equal(quicker?.percentile, 50);
    assert.equal(slower?.percentile, 50);
  });

  it('keeps an ungraded retake and an unscored sitting off the board entirely', async () => {
    const rows = [
      sat('att_graded', 40, 20),
      sat('att_retake', 95, 10, { isGraded: false }),
      sat('att_unscored', 0, 10, { score: null, status: ATTEMPT_STATUS.SUBMITTED }),
    ];
    const { leaderboard } = board(rows);
    for (const row of rows) await leaderboard.record(row);

    assert.equal((await leaderboard.standing(TEST_ID, 'att_graded'))?.cohortSize, 1);
    assert.equal(await leaderboard.standing(TEST_ID, 'att_retake'), null);
  });

  /** The failure this prevents: a Redis restart silently reading as "nobody has sat this yet". */
  it('rebuilds a wiped board from the durable marks, in the same order', async () => {
    const rows = [
      sat('att_a', 90, 20),
      sat('att_b', 60, 15),
      sat('att_c', 60, 25),
      sat('att_d', 20, 10),
    ];
    const { redis, leaderboard } = board(rows);
    for (const row of rows) await leaderboard.record(row);
    const before = redis.descending(redisKeys.testLeaderboard(TEST_ID));

    await redis.del(redisKeys.testLeaderboard(TEST_ID));
    assert.equal(await leaderboard.rebuild(TEST_ID), 4);

    assert.deepEqual(redis.descending(redisKeys.testLeaderboard(TEST_ID)), before);
    assert.deepEqual(await leaderboard.standing(TEST_ID, 'att_b'), {
      rank: 2,
      percentile: 50,
      cohortSize: 4,
    });
  });

  /** The failure this prevents: a read scanning Postgres for 2000 students at once after a wipe. */
  it('asks a job to repair a cold board and reports nothing, rather than repairing it itself', async () => {
    const rows = [sat('att_a', 90, 20), sat('att_b', 60, 15)];
    const { redis, rebuilds, leaderboard } = board(rows);
    for (const row of rows) await leaderboard.record(row);
    await redis.del(redisKeys.testLeaderboard(TEST_ID));

    assert.equal(await leaderboard.standing(TEST_ID, 'att_a'), null);
    assert.deepEqual(rebuilds.jobs[0]?.data, { testId: TEST_ID });
    assert.deepEqual(redis.descending(redisKeys.testLeaderboard(TEST_ID)), []);
  });

  /** The failure this prevents: the first sitting scored after a wipe reading as rank 1 of 1. */
  it('takes no reading off a board it has just found cold, however it was scored', async () => {
    const rows = [sat('att_a', 90, 20), sat('att_b', 20, 15)];
    const { redis, rebuilds, leaderboard } = board(rows);
    for (const row of rows) await leaderboard.record(row);
    await redis.del(redisKeys.testLeaderboard(TEST_ID));

    assert.equal(await leaderboard.rank(rowAt(rows, 1)), null);
    assert.equal(rebuilds.jobs.length, 1);
  });

  it('leaves a board it could not finish rebuilding cold, so something asks again', async () => {
    const rows = [sat('att_a', 90, 20), sat('att_b', 60, 15)];
    const { redis, leaderboard } = board(rows);
    redis.client.rename = () => Promise.reject(new Error('redis went away'));

    await assert.rejects(() => leaderboard.rebuild(TEST_ID));

    assert.deepEqual(redis.descending(redisKeys.testLeaderboard(TEST_ID)), []);
  });

  it('drops a member the durable marks no longer justify', async () => {
    const rows = [sat('att_a', 90, 20), sat('att_b', 60, 15)];
    const { redis, leaderboard } = board(rows);
    for (const row of rows) await leaderboard.record(row);
    rowAt(rows, 1).isGraded = false;

    await redis.del(redisKeys.testLeaderboardRebuild(TEST_ID));
    await leaderboard.rebuild(TEST_ID);

    assert.deepEqual(redis.descending(redisKeys.testLeaderboard(TEST_ID)), ['att_a']);
  });

  it('writes the snapshot Postgres keeps for the screens Redis cannot answer', async () => {
    const rows = [sat('att_a', 90, 20), sat('att_b', 60, 15), sat('att_c', 20, 10)];
    const { prisma, leaderboard } = board(rows);
    for (const row of rows) await leaderboard.record(row);

    await leaderboard.rank(rowAt(rows, 1));

    assert.equal(prisma.attempts[1]?.lastRank, 2);
    assert.equal(prisma.attempts[1]?.lastPercentile, 50);
  });

  /** Marks are durable and a rank is a cache, so an unreachable Redis must not lose a result. */
  it('reports no standing rather than throwing when Redis cannot be reached', async () => {
    const rows = [sat('att_a', 90, 20)];
    const { redis, leaderboard } = board(rows);
    redis.client.zcard = () => Promise.reject(new Error('redis unreachable'));

    assert.equal(await leaderboard.rank(rowAt(rows)), null);
  });
});
