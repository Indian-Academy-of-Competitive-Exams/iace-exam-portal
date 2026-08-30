import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ATTEMPT_STATUS, PAPER_QUESTION_STATUS } from '@iace/contracts';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import {
  FakeQueue,
  FakeRedis,
  FakeScoringPrisma,
  makeAttempt,
  makeServedAnswer,
  mcqOptions,
  type FakeAttemptRow,
  type FakeServedAnswerRow,
} from './support/fakes';

/** Three questions on one paper: the first right, the second wrong, the third never touched. */
function sitting(overrides: Partial<FakeAttemptRow> = {}): {
  prisma: FakeScoringPrisma;
  attempt: FakeAttemptRow;
  served: FakeServedAnswerRow[];
  processor: ScoringProcessor;
} {
  const attempt = makeAttempt({ status: ATTEMPT_STATUS.SUBMITTED, ...overrides });
  const served = [
    makeServedAnswer({
      questionId: 'q1',
      order: 1,
      options: mcqOptions(2),
      selectedOptionId: 'o2',
    }),
    makeServedAnswer({
      questionId: 'q2',
      order: 2,
      options: mcqOptions(2),
      selectedOptionId: 'o1',
    }),
    makeServedAnswer({ questionId: 'q3', order: 3, options: mcqOptions(2) }),
  ];
  const prisma = new FakeScoringPrisma([attempt], served);
  const redis = new FakeRedis();
  const leaderboard = new LeaderboardService(
    prisma.asService(),
    redis.asService(),
    new FakeQueue().asQueue(),
  );
  return {
    prisma,
    attempt,
    served,
    processor: new ScoringProcessor(prisma.asService(), leaderboard),
  };
}

describe('ScoringProcessor — what it writes', () => {
  it('scores the paper into the sitting and into every question it served', async () => {
    const { prisma, attempt, served, processor } = sitting();

    await processor.score(attempt.id);

    assert.equal(attempt.status, ATTEMPT_STATUS.EVALUATED);
    assert.equal(attempt.score, 1.5);
    assert.deepEqual(
      [attempt.correctCount, attempt.wrongCount, attempt.unattemptedCount],
      [1, 1, 1],
    );
    assert.deepEqual(
      served.map((row) => [row.isCorrect, row.marksAwarded]),
      [
        [true, 2],
        [false, -0.5],
        [null, 0],
      ],
    );
    assert.equal(prisma.attempts[0]?.sectionScores?.[0]?.score, 1.5);
  });

  it('stamps a sitting nobody had stamped, and leaves a stamped one where it was', async () => {
    const stamped = new Date('2026-08-01T05:00:00.000Z');
    const fresh = sitting();
    const rerun = sitting({ status: ATTEMPT_STATUS.EVALUATED, evaluatedAt: stamped });

    await fresh.processor.score(fresh.attempt.id);
    await rerun.processor.score(rerun.attempt.id);

    assert.notEqual(fresh.attempt.evaluatedAt, null);
    assert.equal(rerun.attempt.evaluatedAt, stamped);
  });

  /** The rank snapshot is left out on purpose: a rank moves as the cohort grows, and marks do not. */
  const marksOf = (attempt: FakeAttemptRow, served: FakeServedAnswerRow[]) => ({
    status: attempt.status,
    score: attempt.score,
    correctCount: attempt.correctCount,
    wrongCount: attempt.wrongCount,
    unattemptedCount: attempt.unattemptedCount,
    sectionScores: attempt.sectionScores,
    evaluatedAt: attempt.evaluatedAt,
    questions: served.map((row) => [row.isCorrect, row.marksAwarded]),
  });

  it('writes the same marks the second time, so a redelivered job costs nothing', async () => {
    const { attempt, served, processor } = sitting();

    await processor.score(attempt.id);
    const first = structuredClone(marksOf(attempt, served));
    await processor.score(attempt.id);

    assert.deepEqual(marksOf(attempt, served), first);
  });

  it('re-scores an evaluated sitting, which is how a dropped question reaches it', async () => {
    const { attempt, served, processor } = sitting();
    await processor.score(attempt.id);

    served[1]!.paperItem = { marks: 2, negativeMarks: 0.5, status: PAPER_QUESTION_STATUS.DROPPED };
    await processor.score(attempt.id);

    // The wrong answer is paid rather than penalised: 2 + 2 + 0, not 2 − 0.5 + 0.
    assert.equal(attempt.score, 4);
    assert.equal(served[1]?.marksAwarded, 2);
    assert.equal(served[1]?.isCorrect, false);
  });

  it('leaves a sitting still being sat alone', async () => {
    const { attempt, processor } = sitting({ status: ATTEMPT_STATUS.IN_PROGRESS });

    assert.equal(await processor.score(attempt.id), null);
    assert.equal(attempt.score, null);
    assert.equal(attempt.status, ATTEMPT_STATUS.IN_PROGRESS);
  });

  it('reports an attempt that does not exist rather than throwing at the worker', async () => {
    const { processor } = sitting();

    assert.equal(await processor.score('att_nobody'), null);
  });

  it('scores a question the paper never priced at nothing, rather than crashing on it', async () => {
    const { attempt, served, processor } = sitting();
    served[0]!.paperItem = null;

    await processor.score(attempt.id);

    assert.equal(served[0]?.marksAwarded, 0);
    assert.equal(attempt.score, -0.5);
  });
});
