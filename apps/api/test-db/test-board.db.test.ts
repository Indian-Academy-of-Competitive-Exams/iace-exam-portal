import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
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

const board = (studentId: string, testId: string) => view.board(studentId, { testId });

const rowsOf = (read: Leaderboard): LeaderboardRow[] => [...read.podium, ...read.neighbourhood];

/** The rollup's own watermark, which is what a held ranking is keyed on. */
const countedAt = (testId: string, at: Date) =>
  prisma.testStat.upsert({
    where: { testId },
    create: { testId, evaluatedCount: 0, sumTimeSec: 0, computedAt: at },
    update: { computedAt: at },
  });

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

    assert.equal(read.testId, testId);
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
      rowsOf(read).map((row) => [row.name, row.score]),
      rowsOf(read).map((row) => [`Seat ${row.rank}`, 210 - row.rank * 10]),
    );
    assert.deepEqual(read.you, {
      rank: 8,
      name: 'Seat 8',
      branch: null,
      score: 130,
      percentile: 37.5,
      isYou: true,
    });
    assert.deepEqual(
      rowsOf(read).filter((row) => !row.isYou && row.percentile !== null),
      [],
    );
    leaderboardSchema.parse(read);
  });

  /** The board's own window must quote the standing the score card does, ties and all. */
  it('gives a reader off the podium, level on marks with others, the standing they hold', async () => {
    const testId = await paper();
    const field = [150, 150, 120, 120, 120, 100, 100, 100, 60, 60, 60, 60, 60, 60];
    for (const [seat, score] of field.entries()) {
      await entrant(testId, `Seat ${seat}`, score, { timeTakenSec: 600 + seat });
    }
    const me = await entrant(testId, 'Harshith Diyyala', 100, { timeTakenSec: 3000 });

    const read = await board(me.studentId, testId);
    const standing = await leaderboard.standing(testId, me.attemptId);

    assert.deepEqual(standing, { rank: 9, percentile: 53.33, cohortSize: 15 });
    assert.deepEqual(
      [read.you?.rank, read.you?.percentile, read.cohortSize],
      [standing.rank, standing.percentile, standing.cohortSize],
    );
    assert.equal(
      read.podium.some((row) => row.isYou),
      false,
    );
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
      rowsOf(read).map((row) => [row.rank, row.name, row.score]),
      [[1, 'Harshith Diyyala', 90]],
    );
  });

  /** Real names are on this payload, so what identifies a sitting must never ride with them. */
  it('never carries a sitting’s own id, only a name, a branch and a standing', async () => {
    const testId = await paper();
    const rival = await entrant(testId, 'Priya Sharma', 120);
    const me = await entrant(testId, 'Harshith Diyyala', 90);

    const read = await board(me.studentId, testId);

    const payload = JSON.stringify(read);
    assert.equal(payload.includes(rival.attemptId), false);
    assert.equal(payload.includes(me.attemptId), false);
    assert.equal(payload.includes(rival.studentId), false);
  });

  /** A graded sitting with no marks yet is in no cohort, so its reader sees a board with nobody on it. */
  it('draws an empty board for a sitting the cohort does not count', async () => {
    const testId = await paper();
    await entrant(testId, 'Priya Sharma', 120);
    const me = await entrant(testId, 'Harshith Diyyala', 90);
    await prisma.attempt.update({ where: { id: me.attemptId }, data: { score: null } });

    const read = await board(me.studentId, testId);

    assert.deepEqual(
      [read.label, read.cohortSize, read.podium, read.neighbourhood, read.you],
      ['Board mock', 0, [], [], null],
    );
  });

  /** The failure this prevents: a held board quoting a rank the reader's own score card does not. */
  it('counts the reader’s own standing now, however old the ranking around it is', async () => {
    const testId = await paper();
    const mine = await entrant(testId, 'Harshith Diyyala', 100);
    await entrant(testId, 'Priya Sharma', 90);
    await countedAt(testId, new Date('2026-09-01T06:00:00.000Z'));
    await board(mine.studentId, testId);

    await entrant(testId, 'Latecomer', 200);
    const read = await board(mine.studentId, testId);

    assert.deepEqual([read.cohortSize, read.you?.rank], [3, 2]);
    assert.deepEqual(await leaderboard.standing(testId, mine.attemptId), {
      rank: read.you?.rank,
      percentile: read.you?.percentile,
      cohortSize: read.cohortSize,
    });
  });

  /** The failure this prevents: a held ranking outliving the recount that renamed a seat on it. */
  it('holds the seats around the reader until the rollup has counted again', async () => {
    const testId = await paper();
    const mine = await entrant(testId, 'Harshith Diyyala', 100);
    const rival = await entrant(testId, 'Priya Sharma', 90);
    await countedAt(testId, new Date('2026-09-03T06:00:00.000Z'));
    const named = (read: Leaderboard) => rowsOf(read).map((row) => row.name);

    const before = await board(mine.studentId, testId);
    await prisma.student.update({
      where: { id: rival.studentId },
      data: { fullName: 'Renamed Rival' },
    });
    const held = await board(mine.studentId, testId);
    await countedAt(testId, new Date('2026-09-04T06:00:00.000Z'));
    const after = await board(mine.studentId, testId);

    assert.deepEqual(named(before), ['Harshith Diyyala', 'Priya Sharma']);
    assert.deepEqual(named(held), ['Harshith Diyyala', 'Priya Sharma']);
    assert.deepEqual(named(after), ['Harshith Diyyala', 'Renamed Rival']);
  });

  /** The failure this prevents: a sitting scored since the last rollup reading as nobody on the board. */
  it('counts a reader the held ranking does not have yet from the cohort itself', async () => {
    const testId = await paper();
    const early = await entrant(testId, 'Priya Sharma', 100);
    await countedAt(testId, new Date('2026-09-03T06:00:00.000Z'));
    await board(early.studentId, testId);

    const late = await entrant(testId, 'Harshith Diyyala', 50);
    const read = await board(late.studentId, testId);

    assert.deepEqual([read.cohortSize, read.you?.rank, read.you?.percentile], [2, 2, 25]);
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
