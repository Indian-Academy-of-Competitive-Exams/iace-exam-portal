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
    SELECT "id" FROM "Attempt" WHERE "id" = ANY(${[...ids]}::uuid[]) ORDER BY "id"
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

  /** The failure this prevents: every sitting a student ever sat costing its own cohort count, per read. */
  it('reads only the newest few when it is bounded, newest by when they were handed in', async () => {
    const { id: studentId } = await makeStudent(prisma);
    const sat: { attemptId: string; day: number }[] = [];
    for (let day = 1; day <= 7; day += 1) {
      const { id } = await makeSitting(prisma, {
        testId: await paper(),
        studentId,
        score: 100,
        submittedAt: new Date(Date.UTC(2026, 0, day, 6)),
      });
      sat.push({ attemptId: id, day });
    }

    const standings = await leaderboard.standingsOfStudent(studentId, 3);

    assert.equal(standings.size, 3);
    assert.deepEqual(
      [...standings.values()].map((standing) => standing.attemptId).sort(),
      sat
        .filter((row) => row.day > 4)
        .map((row) => row.attemptId)
        .sort(),
    );
    // Unbounded still reads the whole history, which is what a data export asks for.
    assert.equal((await leaderboard.standingsOfStudent(studentId)).size, 7);
  });
});

describe('standingsOf', () => {
  /** The defect this prevents: the map came from a query that scanned the student's whole history. */
  it('reads only the named sittings, not the rest of the student’s history', async () => {
    const [one, two, three] = [await paper(), await paper(), await paper()];
    const mine = await sitter(one, 120);
    const also = await makeSitting(prisma, { testId: two, studentId: mine.studentId, score: 40 });
    await makeSitting(prisma, { testId: three, studentId: mine.studentId, score: 90 });

    const standings = await leaderboard.standingsOf([mine.attemptId, also.id]);

    assert.equal(standings.size, 2);
    assert.deepEqual(standings.get(mine.attemptId), {
      attemptId: mine.attemptId,
      testId: one,
      rank: 1,
      percentile: 100,
      cohortSize: 1,
    });
    assert.deepEqual(standings.get(also.id), {
      attemptId: also.id,
      testId: two,
      rank: 1,
      percentile: 100,
      cohortSize: 1,
    });
  });

  it('reads no standings for an empty list, without a query', async () => {
    assert.equal((await leaderboard.standingsOf([])).size, 0);
  });
});

describe('standingsOfTests', () => {
  it('gives every ranked sitting the standing the per-sitting count gives it, ties included', async () => {
    const [first, second] = [await paper(), await paper()];
    const sat = [
      await sitter(first, 90, { timeTakenSec: 1200 }),
      await sitter(first, 90, { timeTakenSec: 2400 }),
      await sitter(first, 90, { timeTakenSec: 2400 }),
      await sitter(first, 40),
      await sitter(second, 70),
      await sitter(second, 10),
    ];
    const retake = await sitter(first, 99, { isGraded: false, attemptNo: 2 });

    const whole = await leaderboard.standingsOfTests([first, second]);
    const each = await leaderboard.standingsOf(sat.map((row) => row.attemptId));

    assert.equal(whole.size, sat.length);
    assert.equal(whole.has(retake.attemptId), false);
    for (const { attemptId, studentId } of sat) {
      const { rank, percentile, cohortSize } = each.get(attemptId) ?? {};
      assert.deepEqual(
        whole.get(attemptId),
        { attemptId, studentId, testId: each.get(attemptId)?.testId, rank, percentile, cohortSize },
        attemptId,
      );
    }
  });

  it('returns only the sittings handed in within a period, still ranked among every sitting', async () => {
    const testId = await paper();
    const june = new Date('2026-06-09T06:00:00.000Z');
    await sitter(testId, 90, { submittedAt: new Date('2026-05-01T06:00:00.000Z') });
    const inPeriod = await sitter(testId, 40, { submittedAt: june });

    const within = await leaderboard.standingsOfTests([testId], {
      gte: new Date('2026-06-01T00:00:00.000Z'),
      lte: new Date('2026-06-30T00:00:00.000Z'),
    });

    assert.deepEqual([...within.keys()], [inPeriod.attemptId]);
    assert.equal(within.get(inPeriod.attemptId)?.rank, 2);
    assert.equal(within.get(inPeriod.attemptId)?.cohortSize, 2);
  });
});

describe('cohortsOf', () => {
  it('sums a cohort up, and names as its topper whoever holds rank 1', async () => {
    const testId = await paper();
    await sitter(testId, 80, { timeTakenSec: 2400 });
    const fastest = await sitter(testId, 80, { timeTakenSec: 1200 });
    await sitter(testId, 35);
    await sitter(testId, 100, { isGraded: false, attemptNo: 2 });

    const cohorts = await leaderboard.cohortsOf([testId, await paper()]);

    assert.equal(cohorts.size, 1);
    assert.deepEqual(cohorts.get(testId), {
      size: 3,
      mean: 65,
      highest: 80,
      topperId: fastest.studentId,
    });
    assert.equal(await rankOf(testId, fastest.attemptId), 1);
  });
});
