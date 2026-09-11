import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import { ATTEMPT_STATUS } from '@iace/contracts';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import {
  makeCatalog,
  makeSitting,
  makeStudent,
  makeTest,
  testPrisma,
  type SittingInput,
} from './support/database';

const prisma = testPrisma();
const leaderboard = new LeaderboardService(prisma);

after(() => prisma.$disconnect());

type Sat = Omit<SittingInput, 'testId' | 'studentId' | 'score'>;

async function paper(): Promise<string> {
  return (await makeTest(prisma, await makeCatalog(prisma))).id;
}

/** A new student's sitting on the paper, so every row here belongs to this file's own cohort. */
async function sitter(testId: string, score: number, sat: Sat = {}) {
  const { id: studentId } = await makeStudent(prisma);
  const { id } = await makeSitting(prisma, { testId, studentId, score, ...sat });
  return { studentId, attemptId: id };
}

/** The database's own collation decides which of two ids is lower, so it is asked, not assumed. */
async function inIdOrder(ids: readonly string[]): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "Attempt" WHERE "id" = ANY(${[...ids]}::text[]) ORDER BY "id"
  `);
  return rows.map((row) => row.id);
}

async function rankOf(testId: string, attemptId: string): Promise<number | undefined> {
  return (await leaderboard.standing(testId, attemptId))?.rank;
}

describe('standing', () => {
  it('ranks on marks, then on time taken, then on id', async () => {
    const testId = await paper();
    const top = await sitter(testId, 150, { timeTakenSec: 3000 });
    const fast = await sitter(testId, 120, { timeTakenSec: 1200 });
    const slow = await sitter(testId, 120, { timeTakenSec: 2400 });
    const level = [
      await sitter(testId, 90, { timeTakenSec: 1800 }),
      await sitter(testId, 90, { timeTakenSec: 1800 }),
    ];
    const [lower, higher] = await inIdOrder(level.map((row) => row.attemptId));
    assert.ok(lower);
    assert.ok(higher);

    assert.equal(await rankOf(testId, top.attemptId), 1);
    assert.equal(await rankOf(testId, fast.attemptId), 2);
    assert.equal(await rankOf(testId, slow.attemptId), 3);
    assert.equal(await rankOf(testId, lower), 4);
    assert.equal(await rankOf(testId, higher), 5);
  });

  it('gives sittings level on marks the same percentile, whatever their ranks', async () => {
    const testId = await paper();
    const top = await sitter(testId, 150);
    const fast = await sitter(testId, 120, { timeTakenSec: 1200 });
    const slow = await sitter(testId, 120, { timeTakenSec: 2400 });
    const last = await sitter(testId, 90);

    const standings = await Promise.all(
      [top, fast, slow, last].map((row) => leaderboard.standing(testId, row.attemptId)),
    );

    assert.deepEqual(standings, [
      { rank: 1, percentile: 87.5, cohortSize: 4 },
      { rank: 2, percentile: 50, cohortSize: 4 },
      { rank: 3, percentile: 50, cohortSize: 4 },
      { rank: 4, percentile: 12.5, cohortSize: 4 },
    ]);
  });

  it('leaves a voided sitting, a retake and an unscored sitting outside the cohort', async () => {
    const testId = await paper();
    const counted = await sitter(testId, 120);
    const voided = await sitter(testId, 150, { status: ATTEMPT_STATUS.VOIDED });
    const retake = await makeSitting(prisma, {
      testId,
      studentId: counted.studentId,
      score: 200,
      isGraded: false,
      attemptNo: 2,
    });
    const unscored = await sitter(testId, 0, { status: ATTEMPT_STATUS.SUBMITTED });
    await prisma.attempt.update({ where: { id: unscored.attemptId }, data: { score: null } });

    assert.deepEqual(await leaderboard.standing(testId, counted.attemptId), {
      rank: 1,
      percentile: 100,
      cohortSize: 1,
    });
    assert.equal(await leaderboard.standing(testId, voided.attemptId), null);
    assert.equal(await leaderboard.standing(testId, retake.id), null);
    assert.equal(await leaderboard.standing(testId, unscored.attemptId), null);
  });

  it('counts the sitting ranked after a void that handed the ranked slot back', async () => {
    const testId = await paper();
    await sitter(testId, 150);
    const regranted = await sitter(testId, 180, {
      status: ATTEMPT_STATUS.VOIDED,
      isGraded: false,
    });
    const second = await makeSitting(prisma, {
      testId,
      studentId: regranted.studentId,
      score: 100,
      attemptNo: 2,
    });

    assert.equal(await leaderboard.standing(testId, regranted.attemptId), null);
    assert.deepEqual(await leaderboard.standing(testId, second.id), {
      rank: 2,
      percentile: 25,
      cohortSize: 2,
    });
  });

  /** The defect this whole change removes: a first sitter's percentile saved once and never again. */
  it('gives a first sitter 100, and moves it when a higher sitting arrives', async () => {
    const testId = await paper();
    const first = await sitter(testId, 90);

    assert.deepEqual(await leaderboard.standing(testId, first.attemptId), {
      rank: 1,
      percentile: 100,
      cohortSize: 1,
    });

    await sitter(testId, 150);

    assert.deepEqual(await leaderboard.standing(testId, first.attemptId), {
      rank: 2,
      percentile: 25,
      cohortSize: 2,
    });
  });

  it('has nothing to say about a sitting on some other paper', async () => {
    const testId = await paper();
    const mine = await sitter(testId, 90);

    assert.equal(await leaderboard.standing(await paper(), mine.attemptId), null);
  });
});

describe('standingsOfStudent', () => {
  it('reads every graded sitting of one student against its own paper, keyed by sitting', async () => {
    const [one, other] = [await paper(), await paper()];
    const mine = await sitter(one, 120);
    await sitter(one, 150);
    await sitter(one, 60);
    const onOther = await makeSitting(prisma, {
      testId: other,
      studentId: mine.studentId,
      score: 40,
    });
    const retake = await makeSitting(prisma, {
      testId: one,
      studentId: mine.studentId,
      score: 200,
      isGraded: false,
      attemptNo: 2,
    });

    const standings = await leaderboard.standingsOfStudent(mine.studentId);

    assert.equal(standings.size, 2);
    assert.deepEqual(standings.get(mine.attemptId), {
      attemptId: mine.attemptId,
      testId: one,
      rank: 2,
      percentile: 50,
      cohortSize: 3,
    });
    assert.deepEqual(standings.get(onOther.id), {
      attemptId: onOther.id,
      testId: other,
      rank: 1,
      percentile: 100,
      cohortSize: 1,
    });
    assert.equal(standings.has(retake.id), false);
  });

  it('reads a student who has sat nothing as no standings at all', async () => {
    const { id } = await makeStudent(prisma);

    assert.equal((await leaderboard.standingsOfStudent(id)).size, 0);
  });
});
