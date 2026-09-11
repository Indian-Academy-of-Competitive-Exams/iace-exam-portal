import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  ATTEMPT_STATUS,
  LEADERBOARD_MEASURES,
  LEADERBOARD_SCOPES,
  leaderboardSchema,
  type Leaderboard,
  type LeaderboardRow,
} from '@iace/contracts';
import { type LeaderboardService } from '../src/attempts/leaderboard.service';
import { LeaderboardViewService } from '../src/attempts/leaderboard-view.service';
import { type RedisService } from '../src/redis/redis.service';
import {
  makeCatalog,
  makeSitting,
  makeStudent,
  makeTest,
  testPrisma,
  type StudentOverrides,
} from './support/database';

const prisma = testPrisma();
// Redis and the live ranking serve only the one-paper board; the points board never reaches them.
const view = new LeaderboardViewService(prisma, {} as RedisService, {} as LeaderboardService);

after(() => prisma.$disconnect());

/** Every sitting carries the same marks, so any order on a board came from saved percentiles. */
const SCORE = 120;
const START_MS = Date.parse('2026-09-01T05:00:00.000Z');
const DAY_MS = 86_400_000;
const onDay = (day: number) => new Date(START_MS + day * DAY_MS);

async function seriesOf(papers: number): Promise<{ seriesId: string; testIds: string[] }> {
  const catalog = await makeCatalog(prisma);
  const testIds: string[] = [];
  for (let paper = 0; paper < papers; paper += 1) {
    testIds.push((await makeTest(prisma, catalog)).id);
  }
  return { seriesId: catalog.testSeriesId, testIds };
}

/** A student with one graded sitting per saved percentile, the n-th on paper n and on day n. */
async function entrant(
  fullName: string | null,
  testIds: readonly string[],
  percentiles: readonly number[],
  student: StudentOverrides = {},
): Promise<string> {
  const { id } = await makeStudent(prisma, { fullName, ...student });
  for (const [paper, lastPercentile] of percentiles.entries()) {
    const testId = testIds[paper];
    assert.ok(testId, `there is no paper ${paper} to sit`);
    await makeSitting(prisma, {
      testId,
      studentId: id,
      score: SCORE,
      lastPercentile,
      submittedAt: onDay(paper),
    });
  }
  return id;
}

const seriesBoard = (studentId: string, seriesId: string) =>
  view.board(studentId, { scope: LEADERBOARD_SCOPES.SERIES, seriesId });

const rowsOf = (board: Leaderboard): LeaderboardRow[] => [...board.podium, ...board.neighbourhood];

describe('the points board for a series', () => {
  it('ranks on the average saved percentile, and puts more sittings first on a tie', async () => {
    const { seriesId, testIds } = await seriesOf(2);
    await entrant('Vamshi Krishna', testIds, [70]);
    await entrant('Priya Sharma', testIds, [90, 80]);
    await entrant('Ananya Rao', testIds, [60, 80]);
    const me = await entrant('Harshith Diyyala', testIds, [50, 64]);

    const board = await seriesBoard(me, seriesId);

    assert.equal(board.measure, LEADERBOARD_MEASURES.PERCENTILE_POINTS);
    assert.equal(board.cohortSize, 4);
    assert.deepEqual(
      rowsOf(board).map(({ rank, name, value, sittings }) => ({ rank, name, value, sittings })),
      [
        { rank: 1, name: 'Priya Sharma', value: 85, sittings: 2 },
        { rank: 2, name: 'Ananya Rao', value: 70, sittings: 2 },
        { rank: 3, name: 'Vamshi Krishna', value: 70, sittings: 1 },
        { rank: 4, name: 'Harshith Diyyala', value: 57, sittings: 2 },
      ],
    );
    assert.equal(board.you?.rank, 4);
    leaderboardSchema.parse(board);
  });

  it('counts only graded, evaluated sittings', async () => {
    const { seriesId, testIds } = await seriesOf(2);
    const [first, second] = testIds;
    assert.ok(first);
    assert.ok(second);
    const me = await entrant('Harshith Diyyala', [first], [60]);
    await makeSitting(prisma, {
      testId: first,
      studentId: me,
      score: SCORE,
      lastPercentile: 100,
      isGraded: false,
      attemptNo: 2,
    });
    await makeSitting(prisma, {
      testId: second,
      studentId: me,
      score: SCORE,
      lastPercentile: 100,
      status: ATTEMPT_STATUS.VOIDED,
    });

    const board = await seriesBoard(me, seriesId);

    assert.equal(board.cohortSize, 1);
    assert.equal(board.you?.value, 60);
    assert.equal(board.you?.sittings, 1);
  });

  it('leaves an erased student off the board and out of the cohort', async () => {
    const { seriesId, testIds } = await seriesOf(1);
    const erasedAt = new Date();
    await entrant(null, testIds, [99], { deletedAt: erasedAt, anonymizedAt: erasedAt });
    await entrant('Priya Sharma', testIds, [80]);
    const me = await entrant('Harshith Diyyala', testIds, [60]);

    const board = await seriesBoard(me, seriesId);

    assert.equal(board.cohortSize, 2);
    assert.deepEqual(
      rowsOf(board).map((row) => row.name),
      ['Priya Sharma', 'Harshith Diyyala'],
    );
    assert.equal(board.you?.rank, 2);
  });

  it('shows the podium and the reader among their neighbours, and nobody in between', async () => {
    const { seriesId, testIds } = await seriesOf(1);
    const ids: string[] = [];
    for (let seat = 1; seat <= 10; seat += 1) {
      ids.push(await entrant(`Seat ${seat}`, testIds, [100 - seat * 5]));
    }
    const me = ids[7];
    assert.ok(me);

    const board = await seriesBoard(me, seriesId);

    assert.equal(board.cohortSize, 10);
    assert.deepEqual(
      board.podium.map((row) => row.rank),
      [1, 2, 3],
    );
    assert.deepEqual(
      board.neighbourhood.map((row) => row.rank),
      [5, 6, 7, 8, 9, 10],
    );
    assert.equal(
      rowsOf(board).every((row) => row.name === `Seat ${row.rank}`),
      true,
    );
    assert.deepEqual(
      rowsOf(board)
        .filter((row) => row.isYou)
        .map((row) => row.rank),
      [8],
    );
  });

  it('moves the reader against where they stood before their latest sitting', async () => {
    const { seriesId, testIds } = await seriesOf(2);
    const [first, second] = testIds;
    assert.ok(first);
    assert.ok(second);
    const { id: me } = await makeStudent(prisma, { fullName: 'Harshith Diyyala' });
    // The latest sitting goes in first and on the first paper, so only submittedAt can mark it.
    await makeSitting(prisma, {
      testId: first,
      studentId: me,
      score: SCORE,
      lastPercentile: 90,
      submittedAt: onDay(2),
    });
    await makeSitting(prisma, {
      testId: second,
      studentId: me,
      score: SCORE,
      lastPercentile: 40,
      submittedAt: onDay(1),
    });
    for (const percentile of [80, 70, 60, 50, 30]) {
      await entrant(`Scored ${percentile}`, [first], [percentile]);
    }

    const board = await seriesBoard(me, seriesId);

    // 65 now is third; the 40 held before the latest sitting was fifth, behind 80, 70, 60 and 50.
    assert.equal(board.you?.value, 65);
    assert.equal(board.you?.rank, 3);
    assert.equal(board.you?.deltaRank, 2);
    assert.equal(
      rowsOf(board).every((row) => row.isYou || row.deltaRank === null),
      true,
    );
  });

  it('gives a reader with a single sitting no movement', async () => {
    const { seriesId, testIds } = await seriesOf(1);
    await entrant('Priya Sharma', testIds, [80]);
    const me = await entrant('Harshith Diyyala', testIds, [60]);

    const board = await seriesBoard(me, seriesId);

    assert.equal(board.you?.rank, 2);
    assert.equal(board.you?.deltaRank, null);
  });
});

describe('the points board across every paper', () => {
  it('counts the reader in every series, and only a live student above them moves them down', async () => {
    const one = await seriesOf(1);
    const other = await seriesOf(1);
    const me = await entrant('Harshith Diyyala', [...one.testIds, ...other.testIds], [60, 70]);
    const standing = async () => {
      const board = await view.board(me, { scope: LEADERBOARD_SCOPES.ALL_TIME });
      assert.ok(board.you);
      return { you: board.you, cohortSize: board.cohortSize };
    };

    // Every file and earlier run shares this board, so only this test's own rows are measured.
    const before = await standing();
    assert.equal(before.you.value, 65);
    assert.equal(before.you.sittings, 2);

    const erasedAt = new Date();
    await entrant(null, one.testIds, [90], { deletedAt: erasedAt, anonymizedAt: erasedAt });
    const afterErasure = await standing();
    assert.equal(afterErasure.you.rank, before.you.rank);
    assert.equal(afterErasure.cohortSize, before.cohortSize);

    await entrant('Priya Sharma', one.testIds, [90]);
    const afterHigher = await standing();
    assert.equal(afterHigher.you.rank, before.you.rank + 1);
    assert.equal(afterHigher.cohortSize, before.cohortSize + 1);

    await entrant('Vamshi Krishna', other.testIds, [40]);
    const afterLower = await standing();
    assert.equal(afterLower.you.rank, afterHigher.you.rank);
    assert.equal(afterLower.cohortSize, afterHigher.cohortSize + 1);
  });
});
