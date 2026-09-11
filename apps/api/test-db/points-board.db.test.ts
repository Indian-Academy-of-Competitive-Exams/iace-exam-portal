import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  LEADERBOARD_MEASURES,
  LEADERBOARD_SCOPES,
  leaderboardSchema,
  type Leaderboard,
  type LeaderboardRow,
} from '@iace/contracts';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import { LeaderboardViewService } from '../src/attempts/leaderboard-view.service';
import {
  makeCatalog,
  makeSitting,
  makeStudent,
  makeTest,
  testPrisma,
  uid,
  type StudentOverrides,
} from './support/database';

const prisma = testPrisma();
const view = new LeaderboardViewService(prisma, new LeaderboardService(prisma));

after(() => prisma.$disconnect());

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

/** A student's marks on each paper in order, sat on the day matching its place; null skips one. */
async function entrant(
  fullName: string | null,
  testIds: readonly string[],
  marks: readonly (number | null)[],
  student: StudentOverrides = {},
): Promise<string> {
  const { id } = await makeStudent(prisma, { fullName, ...student });
  for (const [paper, score] of marks.entries()) {
    const testId = testIds[paper];
    assert.ok(testId, `there is no paper ${paper} to sit`);
    if (score === null) continue;
    await makeSitting(prisma, { testId, studentId: id, score, submittedAt: onDay(paper) });
  }
  return id;
}

/** Two fresh student ids, lower first in the database's own collation. */
async function idsInOrder(): Promise<[string, string]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM unnest(${[uid('student'), uid('student')]}::text[]) AS id ORDER BY id
  `);
  const [lower, higher] = rows.map((row) => row.id);
  assert.ok(lower);
  assert.ok(higher);
  return [lower, higher];
}

const seriesBoard = (studentId: string, seriesId: string) =>
  view.board(studentId, { scope: LEADERBOARD_SCOPES.SERIES, seriesId });

const rowsOf = (board: Leaderboard): LeaderboardRow[] => [...board.podium, ...board.neighbourhood];

describe('the points board for a series', () => {
  it('ranks on the average of current percentiles, and puts more sittings first on a tie', async () => {
    const { seriesId, testIds } = await seriesOf(2);
    // Vamshi's id sorts first, so only the sittings count can put Ananya above him on the tie.
    const [vamshiId, ananyaId] = await idsInOrder();
    await entrant('Priya Sharma', testIds, [150, 130]);
    await entrant('Ananya Rao', testIds, [110, 150], { id: ananyaId });
    await entrant('Vamshi Krishna', testIds, [130, null], { id: vamshiId });
    await entrant('Kiran Kumar', testIds, [null, 90]);
    const me = await entrant('Harshith Diyyala', testIds, [90, 110]);

    const board = await seriesBoard(me, seriesId);

    assert.equal(board.measure, LEADERBOARD_MEASURES.PERCENTILE_POINTS);
    assert.equal(board.cohortSize, 5);
    assert.deepEqual(
      rowsOf(board).map(({ rank, name, value, sittings }) => ({ rank, name, value, sittings })),
      [
        { rank: 1, name: 'Priya Sharma', value: 75, sittings: 2 },
        { rank: 2, name: 'Ananya Rao', value: 62.5, sittings: 2 },
        { rank: 3, name: 'Vamshi Krishna', value: 62.5, sittings: 1 },
        { rank: 4, name: 'Harshith Diyyala', value: 25, sittings: 2 },
        { rank: 5, name: 'Kiran Kumar', value: 12.5, sittings: 1 },
      ],
    );
    assert.equal(board.you?.rank, 4);
    leaderboardSchema.parse(board);
  });

  it('counts only graded, evaluated sittings, on the board and in each paper', async () => {
    const { seriesId, testIds } = await seriesOf(2);
    const [first, second] = testIds;
    assert.ok(first);
    assert.ok(second);
    const me = await entrant('Harshith Diyyala', [first], [90]);
    await makeSitting(prisma, {
      testId: first,
      studentId: me,
      score: 200,
      isGraded: false,
      attemptNo: 2,
    });
    await makeSitting(prisma, {
      testId: second,
      studentId: me,
      score: 200,
      status: ATTEMPT_STATUS.VOIDED,
    });

    const board = await seriesBoard(me, seriesId);

    assert.equal(board.cohortSize, 1);
    assert.equal(board.you?.value, 100);
    assert.equal(board.you?.sittings, 1);
  });

  it('leaves an erased student off the board, and still counts their sitting in the paper', async () => {
    const { seriesId, testIds } = await seriesOf(1);
    const erasedAt = new Date();
    await entrant(null, testIds, [150], { deletedAt: erasedAt, anonymizedAt: erasedAt });
    await entrant('Priya Sharma', testIds, [120]);
    const me = await entrant('Harshith Diyyala', testIds, [90]);

    const board = await seriesBoard(me, seriesId);

    assert.equal(board.cohortSize, 2);
    assert.deepEqual(
      rowsOf(board).map((row) => [row.name, row.value]),
      [
        ['Priya Sharma', 50],
        ['Harshith Diyyala', 16.67],
      ],
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
    assert.deepEqual(
      rowsOf(board).map((row) => row.name),
      rowsOf(board).map((row) => `Seat ${row.rank}`),
    );
    assert.deepEqual(
      rowsOf(board)
        .filter((row) => row.isYou)
        .map((row) => row.rank),
      [8],
    );
  });

  it('moves a sitter who sat first down when a higher sitting arrives later', async () => {
    const { seriesId, testIds } = await seriesOf(1);
    const early = await entrant('Early Sitter', testIds, [90]);

    const alone = await seriesBoard(early, seriesId);
    assert.deepEqual([alone.you?.rank, alone.you?.value], [1, 100]);

    await entrant('Later Sitter', testIds, [150]);

    const joined = await seriesBoard(early, seriesId);
    assert.deepEqual(
      rowsOf(joined).map((row) => [row.rank, row.name, row.value]),
      [
        [1, 'Later Sitter', 75],
        [2, 'Early Sitter', 25],
      ],
    );
  });

  it('moves the reader against where they stood before their latest sitting', async () => {
    const { seriesId, testIds } = await seriesOf(2);
    const [first, second] = testIds;
    assert.ok(first);
    assert.ok(second);
    const { id: me } = await makeStudent(prisma, { fullName: 'Harshith Diyyala' });
    // Created first and on the first paper, so only its submittedAt can mark it the latest.
    await makeSitting(prisma, { testId: first, studentId: me, score: 150, submittedAt: onDay(2) });
    await makeSitting(prisma, { testId: second, studentId: me, score: 90, submittedAt: onDay(1) });
    await entrant('Topper', testIds, [null, 150]);
    for (const score of [130, 110, 90]) {
      await entrant(`Scored ${score}`, testIds, [score]);
    }

    const board = await seriesBoard(me, seriesId);

    // 56.25 now is third; the 25 held before the latest sitting was fourth, under 75, 62.5 and 37.5.
    assert.equal(board.you?.value, 56.25);
    assert.equal(board.you?.rank, 3);
    assert.equal(board.you?.deltaRank, 1);
    assert.deepEqual(
      rowsOf(board).filter((row) => !row.isYou && row.deltaRank !== null),
      [],
    );
  });

  it('gives a reader with a single sitting no movement', async () => {
    const { seriesId, testIds } = await seriesOf(1);
    await entrant('Priya Sharma', testIds, [120]);
    const me = await entrant('Harshith Diyyala', testIds, [90]);

    const board = await seriesBoard(me, seriesId);

    assert.equal(board.you?.rank, 2);
    assert.equal(board.you?.deltaRank, null);
  });
});

describe('the points board across every paper', () => {
  it('counts the reader on every paper, and only a live student above them moves them down', async () => {
    const one = (await seriesOf(1)).testIds;
    const two = (await seriesOf(1)).testIds;
    const three = (await seriesOf(1)).testIds;
    const four = (await seriesOf(1)).testIds;
    const five = (await seriesOf(1)).testIds;
    await entrant('Anchor', one, [150]);
    const me = await entrant('Harshith Diyyala', [...one, ...two], [90, 90]);
    const standing = async () => {
      const board = await view.board(me, { scope: LEADERBOARD_SCOPES.ALL_TIME });
      assert.ok(board.you);
      return { you: board.you, cohortSize: board.cohortSize };
    };
    const erasedAt = new Date();
    const erased = { deletedAt: erasedAt, anonymizedAt: erasedAt };

    // Every file and earlier run shares this board, so only this test's own rows are measured.
    const before = await standing();
    assert.equal(before.you.value, 62.5);
    assert.equal(before.you.sittings, 2);

    await entrant(null, three, [150], erased);
    const afterErasure = await standing();
    assert.equal(afterErasure.you.rank, before.you.rank);
    assert.equal(afterErasure.cohortSize, before.cohortSize);

    await entrant('Priya Sharma', four, [120]);
    const afterHigher = await standing();
    assert.equal(afterHigher.you.rank, before.you.rank + 1);
    assert.equal(afterHigher.cohortSize, before.cohortSize + 1);

    await entrant(null, five, [150], erased);
    await entrant('Vamshi Krishna', five, [90]);
    const afterLower = await standing();
    assert.equal(afterLower.you.rank, afterHigher.you.rank);
    assert.equal(afterLower.cohortSize, afterHigher.cohortSize + 1);
    assert.equal(afterLower.you.value, 62.5);
  });
});
