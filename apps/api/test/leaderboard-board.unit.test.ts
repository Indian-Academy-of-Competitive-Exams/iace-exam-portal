import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { type ExecutionContext } from '@nestjs/common';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
  LEADERBOARD_MEASURES,
  LEADERBOARD_MEASURE_BY_SCOPE,
  LEADERBOARD_SCOPES,
  leaderboardSchema,
  type LeaderboardRow,
} from '@iace/contracts';
import { ActorGuard } from '../src/auth/guards/actor.guard';
import { IS_PUBLIC_KEY, type AuthenticatedUser } from '../src/common/security';
import { MeLeaderboardController } from '../src/attempts/leaderboard.controller';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import { LeaderboardViewService } from '../src/attempts/leaderboard-view.service';
import {
  deltaOf,
  neighbourhoodWindow,
  seatsOf,
  splitBoard,
} from '../src/attempts/leaderboard-board';
import {
  FakeBoardPrisma,
  FakeQueue,
  FakeRedis,
  makeBoardSitting,
  type FakeBoardPointsRow,
  type FakeBoardSeries,
  type FakeBoardSitting,
  type FakeBoardTest,
} from './support/fakes';

// --------------------------------------------------------------------------- shaping a board
// ---------------------------------------------------------------------------

describe('neighbourhoodWindow', () => {
  it('centres on the reader and takes the same number of seats either side', () => {
    assert.deepEqual(neighbourhoodWindow(20, 100), { from: 16, to: 22 });
  });

  it('does not run off either end of a board', () => {
    assert.deepEqual(neighbourhoodWindow(1, 100), { from: 0, to: 3 });
    assert.deepEqual(neighbourhoodWindow(100, 100), { from: 96, to: 99 });
  });

  it('reads a board of one as the single seat it is', () => {
    assert.deepEqual(neighbourhoodWindow(1, 1), { from: 0, to: 0 });
  });
});

describe('seatsOf', () => {
  it('numbers the podium from the top and the window from where it was cut', () => {
    const seats = seatsOf(['a', 'b', 'c'], ['e', 'f', 'g'], 4);

    assert.equal(seats.get('a'), 1);
    assert.equal(seats.get('c'), 3);
    assert.equal(seats.get('e'), 5);
    assert.equal(seats.get('g'), 7);
  });

  /** The failure this prevents: a reader near the top drawn twice, once per read of the board. */
  it('keeps a member the two reads overlap on in one seat', () => {
    const seats = seatsOf(['a', 'b', 'c'], ['a', 'b', 'c', 'd'], 0);

    assert.equal(seats.size, 4);
    assert.equal(seats.get('a'), 1);
    assert.equal(seats.get('d'), 4);
  });
});

describe('deltaOf', () => {
  it('reads a climb as positive and a slide as negative', () => {
    assert.equal(deltaOf(14, 8), 6);
    assert.equal(deltaOf(4, 9), -5);
  });

  it('says nothing where there is no previous standing to move from', () => {
    assert.equal(deltaOf(null, 8), null);
  });
});

describe('splitBoard', () => {
  it('takes the top three as the podium and leaves the rest in order under it', () => {
    const rows = [seat(9), seat(1), seat(4), seat(2)];

    const { podium, neighbourhood } = splitBoard(rows);

    assert.deepEqual(
      podium.map((row) => row.rank),
      [1, 2],
    );
    assert.deepEqual(
      neighbourhood.map((row) => row.rank),
      [4, 9],
    );
  });
});

// --------------------------------------------------------------------------- one paper
// ---------------------------------------------------------------------------

const ME = 'stu_me';
const TEST_ID = 'tst_1';
const DRILL_ID = 'tst_drill';
const START = new Date('2026-09-01T05:00:00.000Z');

const NAMES = [
  'Sai Teja Reddy',
  'Priya Sharma',
  'Vamshi Krishna',
  'Ananya Rao',
  'Karthik Nair',
  'Divya Menon',
  'Rohit Verma',
  'Harshith Diyyala',
  'Sneha Iyer',
  'Aditya Rao',
];

/** Ten sittings, five marks apart, so the seat a name takes is countable by hand. */
function cohort(): FakeBoardSitting[] {
  return NAMES.map((name, index) =>
    makeBoardSitting({
      id: `att_${index + 1}`,
      studentId: index === 7 ? ME : `stu_${index + 1}`,
      fullName: name,
      branch: index % 2 === 0 ? 'AMEERPET' : 'KUKATPALLY',
      score: 100 - index * 5,
      submittedAt: new Date(START.getTime() + 20 * 60_000),
      mobile: `98765000${index}`,
    }),
  );
}

interface BenchOptions {
  tests?: FakeBoardTest[];
  series?: FakeBoardSeries[];
  points?: FakeBoardPointsRow[];
}

async function bench(sittings: FakeBoardSitting[], options: BenchOptions = {}) {
  const prisma = new FakeBoardPrisma(
    sittings,
    options.tests ?? [],
    options.series ?? [],
    options.points ?? [],
  );
  const redis = new FakeRedis();
  const ranking = new LeaderboardService(
    prisma.asService(),
    redis.asService(),
    new FakeQueue().asQueue(),
  );
  const view = new LeaderboardViewService(prisma.asService(), redis.asService(), ranking);
  for (const row of sittings) await ranking.record(row);
  return { prisma, redis, view };
}

const paper = (testId = TEST_ID) => ({ scope: LEADERBOARD_SCOPES.TEST, testId }) as const;

describe('the leaderboard for one paper', () => {
  it('draws a podium off the top of the live ranking and the reader among their neighbours', async () => {
    const { view } = await bench(cohort());

    const board = await view.board(ME, paper());

    assert.equal(board.cohortSize, 10);
    assert.equal(board.measure, LEADERBOARD_MEASURES.MARKS);
    assert.deepEqual(
      board.podium.map((row) => row.name),
      ['Sai Teja Reddy', 'Priya Sharma', 'Vamshi Krishna'],
    );
    assert.equal(board.podium[0]?.value, 100);
    assert.equal(board.you?.rank, 8);
    assert.equal(board.you?.name, 'Harshith Diyyala');
    assert.equal(board.you?.branch, 'KUKATPALLY');
    assert.deepEqual(
      board.neighbourhood.map((row) => row.rank),
      [5, 6, 7, 8, 9, 10],
    );
    assert.equal(board.neighbourhood.filter((row) => row.isYou).length, 1);
    leaderboardSchema.parse(board);
  });

  /** The failure this prevents: a second sitting of the same paper outranking everyone's first. */
  it('leaves a retake off the board however well it scored', async () => {
    const retake = makeBoardSitting({
      id: 'att_retake',
      studentId: ME,
      fullName: 'Harshith Diyyala',
      score: 200,
      isGraded: false,
      submittedAt: new Date(START.getTime() + 10 * 60_000),
    });
    const { view } = await bench([...cohort(), retake]);

    const board = await view.board(ME, paper());

    assert.equal(board.cohortSize, 10);
    assert.equal(board.podium[0]?.value, 100);
    assert.equal(board.you?.rank, 8);
  });

  /** Every test ranks, so no paper a reader holds a graded sitting on is left without a board. */
  it('builds a board for any test the reader holds a graded sitting on', async () => {
    const drill = cohort().map((row, index) =>
      makeBoardSitting({ ...row, id: `drill_${index}`, testId: DRILL_ID }),
    );
    const { view } = await bench(drill, { tests: [{ id: DRILL_ID, title: 'Speed drill 3' }] });

    const board = await view.board(ME, paper(DRILL_ID));

    assert.equal(board.label, 'Speed drill 3');
    assert.equal(board.cohortSize, 10);
    assert.equal(board.podium[0]?.name, 'Sai Teja Reddy');
    assert.equal(board.you?.rank, 8);
  });

  it('refuses a cohort the reader never sat in', async () => {
    const { view } = await bench(cohort());

    await assert.rejects(
      () => view.board(ME, paper('tst_somebody_elses')),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });

  it('measures a climb from where the last snapshot left them', async () => {
    const rows = cohort();
    const mine = rows[7];
    if (mine) mine.lastRank = 14;
    const { view } = await bench(rows);

    const board = await view.board(ME, paper());

    assert.equal(board.you?.deltaRank, 6);
    assert.equal(board.podium[0]?.deltaRank, null);
  });
});

// --------------------------------------------------------------------------- what a row may carry
// ---------------------------------------------------------------------------

/** The whole of a leaderboard row. Adding to this list is a privacy decision, not a refactor. */
const ROW_FIELDS = [
  'branch',
  'deltaRank',
  'isYou',
  'name',
  'percentile',
  'rank',
  'sittings',
  'value',
];

describe('what a leaderboard row is allowed to say about somebody', () => {
  it('carries a name, a branch and a standing, and nothing else that identifies them', async () => {
    const { view } = await bench(cohort());

    const board = await view.board(ME, paper());
    const other = board.podium[0];

    assert.ok(other);
    assert.deepEqual(Object.keys(other).sort(), ROW_FIELDS);
    assert.equal(JSON.stringify(board).includes('98765000'), false);
    assert.equal(JSON.stringify(board).includes('att_'), false);
  });

  it('shows the reader their own percentile and nobody else theirs', async () => {
    const { view } = await bench(cohort());

    const board = await view.board(ME, paper());

    assert.notEqual(board.you?.percentile, null);
    assert.equal(
      board.podium.every((row) => row.percentile === null),
      true,
    );
  });
});

// --------------------------------------------------------------------------- across papers
// ---------------------------------------------------------------------------

const SERIES_ID = 'srs_1';

const point = (over: Partial<FakeBoardPointsRow> = {}): FakeBoardPointsRow => ({
  rank: 1,
  points: 91.2,
  sittings: 8,
  cohort: 340,
  name: 'Priya Sharma',
  branch: 'KUKATPALLY',
  is_you: false,
  prior_rank: 62,
  ...over,
});

const POINTS: FakeBoardPointsRow[] = [
  point({ rank: 1, points: 91.2 }),
  point({ rank: 2, points: 88.4, name: 'Vamshi Krishna', branch: 'AMEERPET' }),
  point({ rank: 3, points: 84, name: 'Ananya Rao', branch: 'SR NAGAR' }),
  point({ rank: 55, points: 61.5, name: 'Divya Menon' }),
  point({ rank: 56, points: 61.1, name: 'Harshith Diyyala', is_you: true }),
  point({ rank: 57, points: 60.9, name: 'Sneha Iyer' }),
];

const SERIES: FakeBoardSeries[] = [
  { id: SERIES_ID, name: 'SSC CGL Prelims 2026', testIds: [TEST_ID, 'tst_2'] },
];

describe('a leaderboard across papers', () => {
  /** Marks belong to one paper. A board spanning papers can only honestly rank on percentile. */
  it('never ranks two papers on marks', () => {
    assert.equal(LEADERBOARD_MEASURE_BY_SCOPE.TEST, LEADERBOARD_MEASURES.MARKS);
    assert.equal(LEADERBOARD_MEASURE_BY_SCOPE.SERIES, LEADERBOARD_MEASURES.PERCENTILE_POINTS);
    assert.equal(LEADERBOARD_MEASURE_BY_SCOPE.ALL_TIME, LEADERBOARD_MEASURES.PERCENTILE_POINTS);
  });

  it('ranks a series on the percentile points each sitting already carries', async () => {
    const { view, prisma } = await bench(cohort(), { series: SERIES, points: POINTS });

    const board = await view.board(ME, {
      scope: LEADERBOARD_SCOPES.SERIES,
      seriesId: SERIES_ID,
    });

    assert.equal(prisma.rawReads, 1);
    assert.equal(board.measure, LEADERBOARD_MEASURES.PERCENTILE_POINTS);
    assert.equal(board.label, 'SSC CGL Prelims 2026');
    assert.equal(board.cohortSize, 340);
    assert.equal(board.podium[0]?.value, 91.2);
    assert.equal(board.podium[0]?.sittings, 8);
    assert.equal(board.you?.rank, 56);
    assert.equal(board.you?.name, 'Harshith Diyyala');
    leaderboardSchema.parse(board);
  });

  it('moves only the reader against their own previous standing', async () => {
    const { view } = await bench(cohort(), { series: SERIES, points: POINTS });

    const board = await view.board(ME, {
      scope: LEADERBOARD_SCOPES.SERIES,
      seriesId: SERIES_ID,
    });

    assert.equal(board.you?.deltaRank, 6);
    assert.equal(
      board.neighbourhood.every((row) => row.isYou || row.deltaRank === null),
      true,
    );
  });

  it('answers an all-time board without asking about a series at all', async () => {
    const { view } = await bench(cohort(), { points: POINTS });

    const board = await view.board(ME, { scope: LEADERBOARD_SCOPES.ALL_TIME });

    assert.equal(board.scopeId, null);
    assert.equal(board.label, null);
    assert.equal(board.measure, LEADERBOARD_MEASURES.PERCENTILE_POINTS);
    assert.equal(board.you?.rank, 56);
  });

  it('refuses a series the reader has never sat a paper in', async () => {
    const { view } = await bench(cohort(), { series: SERIES, points: POINTS });

    await assert.rejects(
      () => view.board(ME, { scope: LEADERBOARD_SCOPES.SERIES, seriesId: 'srs_nope' }),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

// --------------------------------------------------------------------------- signed in, always
// ---------------------------------------------------------------------------

describe('reaching the leaderboard', () => {
  const reflector = new Reflector();

  /** Real names are on this payload. A @Public() here would put them on the open internet. */
  it('is not a public route', () => {
    const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      MeLeaderboardController.prototype.read,
      MeLeaderboardController,
    ]);

    assert.equal(isPublic, undefined);
  });

  it('refuses an admin token, valid though it is', () => {
    const guard = new ActorGuard(reflector);
    const request = {
      user: {
        id: 'adm_1',
        actor: ActorTypes.ADMIN,
        sessionId: 's',
        isSuperAdmin: false,
        isActive: true,
        permissions: {},
      } satisfies AuthenticatedUser,
    };
    const context = {
      getHandler: () => MeLeaderboardController.prototype.read,
      getClass: () => MeLeaderboardController,
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    assert.throws(
      () => guard.canActivate(context),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.FORBIDDEN,
    );
  });
});

function seat(rank: number): LeaderboardRow {
  return {
    rank,
    name: `Seat ${rank}`,
    branch: null,
    value: 100 - rank,
    percentile: null,
    sittings: 1,
    deltaRank: null,
    isYou: false,
  };
}
