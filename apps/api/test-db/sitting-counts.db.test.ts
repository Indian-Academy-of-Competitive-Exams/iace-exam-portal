import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
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

async function sitter(testId: string, score: number, sat: Sat = {}) {
  const { id: studentId } = await makeStudent(prisma);
  const { id } = await makeSitting(prisma, { testId, studentId, score, ...sat });
  return { studentId, attemptId: id };
}

describe('sittingCounts', () => {
  it('counts the cohort a score card names, and nothing it leaves out', async () => {
    const testId = await paper();
    const counted = await sitter(testId, 120);
    await sitter(testId, 90);
    await sitter(testId, 60);
    await makeSitting(prisma, {
      testId,
      studentId: counted.studentId,
      score: 200,
      isGraded: false,
      attemptNo: 2,
    });
    await sitter(testId, 180, { status: ATTEMPT_STATUS.VOIDED });
    const unscored = await sitter(testId, 0, { status: ATTEMPT_STATUS.IN_PROGRESS });
    await prisma.attempt.update({ where: { id: unscored.attemptId }, data: { score: null } });

    const counts = await leaderboard.sittingCounts([testId]);
    const standing = await leaderboard.standing(testId, counted.attemptId);

    assert.equal(counts.get(testId), 3);
    assert.equal(counts.get(testId), standing?.cohortSize);
  });

  it('counts several papers in one read, and leaves a paper nobody has ranked on out', async () => {
    const [busy, quiet, unsat] = [await paper(), await paper(), await paper()];
    await sitter(busy, 120);
    await sitter(busy, 90);
    await sitter(quiet, 60);
    await sitter(unsat, 150, { isGraded: false });

    const counts = await leaderboard.sittingCounts([busy, quiet, unsat]);

    assert.deepEqual(
      [busy, quiet, unsat].map((testId) => counts.get(testId)),
      [2, 1, undefined],
    );
    assert.equal(counts.has(unsat), false);
  });

  it('asks nothing of a list with no papers on it', async () => {
    assert.equal((await leaderboard.sittingCounts([])).size, 0);
  });
});
