import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
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
  type SittingInput,
  type StudentOverrides,
} from './support/database';

const prisma = testPrisma();
const leaderboard = new LeaderboardService(prisma);
const view = new LeaderboardViewService(prisma, leaderboard);

after(() => prisma.$disconnect());

type Sat = Omit<SittingInput, 'testId' | 'studentId' | 'score'>;

async function paper(): Promise<string> {
  return (await makeTest(prisma, await makeCatalog(prisma), { title: 'Board mock' })).id;
}

async function entrant(
  testId: string,
  fullName: string | null,
  score: number,
  sat: Sat = {},
  student: StudentOverrides = {},
) {
  const { id: studentId } = await makeStudent(prisma, { fullName, ...student });
  const { id } = await makeSitting(prisma, { testId, studentId, score, ...sat });
  return { studentId, attemptId: id };
}

const board = (studentId: string, testId: string) =>
  view.board(studentId, { scope: LEADERBOARD_SCOPES.TEST, testId });

const rowsOf = (read: Leaderboard): LeaderboardRow[] => [...read.podium, ...read.neighbourhood];

describe('the board for one paper', () => {
  it('draws the podium and the reader among their neighbours, ranked by the database', async () => {
    const testId = await paper();
    const seats: string[] = [];
    for (let seat = 1; seat <= 12; seat += 1) {
      seats.push((await entrant(testId, `Seat ${seat}`, 210 - seat * 10)).studentId);
    }
    const me = seats[7];
    assert.ok(me);

    const read = await board(me, testId);

    assert.equal(read.measure, LEADERBOARD_MEASURES.MARKS);
    assert.equal(read.label, 'Board mock');
    assert.equal(read.cohortSize, 12);
    assert.deepEqual(
      read.podium.map((row) => row.rank),
      [1, 2, 3],
    );
    assert.deepEqual(
      read.neighbourhood.map((row) => row.rank),
      [5, 6, 7, 8, 9, 10, 11],
    );
    assert.deepEqual(
      rowsOf(read).map((row) => [row.name, row.value]),
      rowsOf(read).map((row) => [`Seat ${row.rank}`, 210 - row.rank * 10]),
    );
    assert.deepEqual(read.you, {
      rank: 8,
      name: 'Seat 8',
      branch: null,
      value: 130,
      percentile: 37.5,
      sittings: 1,
      deltaRank: null,
      isYou: true,
    });
    assert.deepEqual(
      rowsOf(read).filter(
        (row) => !row.isYou && (row.percentile !== null || row.deltaRank !== null),
      ),
      [],
    );
    leaderboardSchema.parse(read);
  });

  it('seats equal marks by time taken, and a sitting with no recorded time after a timed one', async () => {
    const testId = await paper();
    const timed = await entrant(testId, 'Timed', 120, { timeTakenSec: 3000 });
    const untimed = await entrant(testId, 'Untimed', 120, { timeTakenSec: 600 });
    await prisma.attempt.update({ where: { id: untimed.attemptId }, data: { timeTakenSec: null } });
    const quick = await entrant(testId, 'Quick', 120, { timeTakenSec: 900 });

    const read = await board(untimed.studentId, testId);

    assert.deepEqual(
      rowsOf(read).map((row) => [row.rank, row.name]),
      [
        [1, 'Quick'],
        [2, 'Timed'],
        [3, 'Untimed'],
      ],
    );
    assert.equal((await leaderboard.standing(testId, quick.attemptId))?.rank, 1);
    assert.equal((await leaderboard.standing(testId, timed.attemptId))?.rank, 2);
    assert.equal((await leaderboard.standing(testId, untimed.attemptId))?.rank, 3);
  });

  it('shows an erased student under the anonymous name and keeps their seat', async () => {
    const testId = await paper();
    const erasedAt = new Date();
    await entrant(testId, null, 150, {}, { deletedAt: erasedAt, anonymizedAt: erasedAt });
    const me = await entrant(testId, 'Harshith Diyyala', 90);

    const read = await board(me.studentId, testId);

    assert.deepEqual(
      rowsOf(read).map((row) => [row.rank, row.name]),
      [
        [1, 'Student'],
        [2, 'Harshith Diyyala'],
      ],
    );
    assert.equal(read.cohortSize, 2);
  });

  it('keeps a retake and a voided sitting off the board however well they scored', async () => {
    const testId = await paper();
    const me = await entrant(testId, 'Harshith Diyyala', 90);
    await makeSitting(prisma, {
      testId,
      studentId: me.studentId,
      score: 200,
      isGraded: false,
      attemptNo: 2,
    });
    await entrant(testId, 'Voided', 180, { status: ATTEMPT_STATUS.VOIDED });

    const read = await board(me.studentId, testId);

    assert.equal(read.cohortSize, 1);
    assert.deepEqual(
      rowsOf(read).map((row) => [row.rank, row.name, row.value]),
      [[1, 'Harshith Diyyala', 90]],
    );
  });

  it('refuses a paper the reader holds no graded sitting on', async () => {
    const testId = await paper();
    await entrant(testId, 'Priya Sharma', 120);
    const { id: stranger } = await makeStudent(prisma);

    await assert.rejects(
      () => board(stranger, testId),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });
});
