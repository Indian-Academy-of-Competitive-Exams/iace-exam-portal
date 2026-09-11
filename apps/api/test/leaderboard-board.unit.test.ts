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
import { LeaderboardViewService } from '../src/attempts/leaderboard-view.service';
import { deltaOf, splitBoard } from '../src/attempts/leaderboard-board';
import { type PointsRow, type TestBoardRow } from '../src/attempts/ranking-sql';
import {
  FakeBoardPrisma,
  FakeLeaderboard,
  makeBoardSitting,
  makeStanding,
  type FakeBoardRawRow,
  type FakeBoardSeries,
  type FakeBoardSitting,
  type FakeBoardTest,
  type FakeStanding,
} from './support/fakes';

// --------------------------------------------------------------------------- shaping a board
// ---------------------------------------------------------------------------

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
const MINE = 'att_8';
const TEST_ID = 'tst_1';
const DRILL_ID = 'tst_drill';

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

/** What the ranking query hands back to a reader eighth of ten: the podium and three either side. */
function seats(): TestBoardRow[] {
  return [1, 2, 3, 5, 6, 7, 8, 9, 10].map((rank) => ({
    attempt_id: `att_${rank}`,
    rank,
    score: 105 - rank * 5,
    cohort: NAMES.length,
    name: NAMES[rank - 1] ?? null,
    branch: rank % 2 === 1 ? 'AMEERPET' : 'KUKATPALLY',
    is_you: rank === 8,
  }));
}

const mine = (testId = TEST_ID) => makeBoardSitting({ id: MINE, studentId: ME, testId });

const MY_STANDING = makeStanding({
  attemptId: MINE,
  studentId: ME,
  rank: 8,
  percentile: 25,
  cohortSize: NAMES.length,
});

interface BenchOptions {
  tests?: FakeBoardTest[];
  series?: FakeBoardSeries[];
  raw?: FakeBoardRawRow[];
  standings?: FakeStanding[];
}

function bench(sittings: FakeBoardSitting[], options: BenchOptions = {}) {
  const prisma = new FakeBoardPrisma(
    sittings,
    options.tests ?? [],
    options.series ?? [],
    options.raw ?? [],
  );
  const leaderboard = new FakeLeaderboard(options.standings ?? []);
  return { prisma, view: new LeaderboardViewService(prisma.asService(), leaderboard.asService()) };
}

const paperBench = () => bench([mine()], { raw: seats(), standings: [MY_STANDING] });

const paper = (testId = TEST_ID) => ({ scope: LEADERBOARD_SCOPES.TEST, testId }) as const;

describe('the leaderboard for one paper', () => {
  it('draws the podium and the reader among their neighbours from the seats Postgres ranked', async () => {
    const { view } = paperBench();

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

  /** A places-moved arrow needs a rank saved from some earlier read, and one paper saves none. */
  it('draws no places-moved arrow on any row', async () => {
    const { view } = paperBench();

    const board = await view.board(ME, paper());

    assert.deepEqual(
      [...board.podium, ...board.neighbourhood].map((row) => row.deltaRank),
      Array.from({ length: 9 }, () => null),
    );
  });

  /** Every test ranks, so no paper a reader holds a graded sitting on is left without a board. */
  it('builds a board for any test the reader holds a graded sitting on', async () => {
    const { view } = bench([mine(DRILL_ID)], {
      tests: [{ id: DRILL_ID, title: 'Speed drill 3' }],
      raw: seats(),
      standings: [{ ...MY_STANDING, testId: DRILL_ID }],
    });

    const board = await view.board(ME, paper(DRILL_ID));

    assert.equal(board.label, 'Speed drill 3');
    assert.equal(board.cohortSize, 10);
    assert.equal(board.podium[0]?.name, 'Sai Teja Reddy');
    assert.equal(board.you?.rank, 8);
  });

  it('refuses a cohort the reader never sat in', async () => {
    const { view } = paperBench();

    await assert.rejects(
      () => view.board(ME, paper('tst_somebody_elses')),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });

  it('draws an empty board for a sitting the cohort does not count', async () => {
    const { view } = bench([mine()], { raw: seats() });

    const board = await view.board(ME, paper());

    assert.deepEqual(
      [board.cohortSize, board.podium, board.neighbourhood, board.you],
      [0, [], [], null],
    );
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
    const { view } = paperBench();

    const board = await view.board(ME, paper());
    const other = board.podium[0];

    assert.ok(other);
    assert.deepEqual(Object.keys(other).sort(), ROW_FIELDS);
    assert.equal(JSON.stringify(board).includes('att_'), false);
  });

  it('shows the reader their own percentile and nobody else theirs', async () => {
    const { view } = paperBench();

    const board = await view.board(ME, paper());

    assert.equal(board.you?.percentile, 25);
    assert.equal(
      board.podium.every((row) => row.percentile === null),
      true,
    );
  });
});

// --------------------------------------------------------------------------- across papers
// ---------------------------------------------------------------------------

const SERIES_ID = 'srs_1';

const point = (over: Partial<PointsRow> = {}): PointsRow => ({
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

const POINTS: PointsRow[] = [
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

  it('ranks a series on the percentile points Postgres counted', async () => {
    const { view, prisma } = bench([mine()], { series: SERIES, raw: POINTS });

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
    const { view } = bench([mine()], { series: SERIES, raw: POINTS });

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
    const { view } = bench([mine()], { raw: POINTS });

    const board = await view.board(ME, { scope: LEADERBOARD_SCOPES.ALL_TIME });

    assert.equal(board.scopeId, null);
    assert.equal(board.label, null);
    assert.equal(board.measure, LEADERBOARD_MEASURES.PERCENTILE_POINTS);
    assert.equal(board.you?.rank, 56);
  });

  it('refuses a series the reader has never sat a paper in', async () => {
    const { view } = bench([mine()], { series: SERIES, raw: POINTS });

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
