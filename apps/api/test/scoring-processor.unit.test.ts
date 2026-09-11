import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ATTEMPT_STATUS, NOTIFICATION_TYPE, PAPER_QUESTION_STATUS } from '@iace/contracts';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import {
  FakeEventBus,
  FakeQueue,
  fakeRollupOutbox,
  FakeScoringPrisma,
  makeAttempt,
  makeServedAnswer,
  mcqOptions,
  rowAt,
  type FakeAttemptRow,
  type FakeServedAnswerRow,
  fakeNotificationOutbox,
} from './support/fakes';

const A_DAY_SEC = 24 * 60 * 60;

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
  const rollups = new FakeQueue();
  return {
    prisma,
    attempt,
    served,
    processor: new ScoringProcessor(
      prisma.asService(),
      fakeRollupOutbox(prisma, rollups),
      new FakeEventBus().asService(),
      fakeNotificationOutbox(prisma),
    ),
  };
}

const notificationIn = (prisma: { outboxEvents: { eventType: string; payload: unknown }[] }) =>
  prisma.outboxEvents
    .filter((row) => row.eventType === 'notification.requested')
    .map((row) => row.payload as Record<string, unknown>)[0];

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

  it('records the time the sitting took beside its marks, and never more than a day', async () => {
    const startedAt = new Date('2026-08-24T04:00:00.000Z');
    const quick = sitting({ startedAt, submittedAt: new Date('2026-08-24T04:20:00.000Z') });
    const overnight = sitting({ startedAt, submittedAt: new Date('2026-08-25T10:00:00.000Z') });
    const unsubmitted = sitting({ startedAt, submittedAt: null });
    const runs = [quick, overnight, unsubmitted];

    for (const run of runs) await run.processor.score(run.attempt.id);

    assert.deepEqual(
      runs.map((run) => run.attempt.timeTakenSec),
      [20 * 60, A_DAY_SEC, A_DAY_SEC],
    );
  });

  /** A first evaluation is RESULT_READY; only a re-score reaches the correction path at all. */
  it('tells a student whose marks a re-score actually moved', async () => {
    const { prisma, attempt, processor } = sitting({
      status: ATTEMPT_STATUS.EVALUATED,
      evaluatedAt: new Date('2026-08-01T05:00:00.000Z'),
      score: 0,
    });

    await processor.score(attempt.id);

    const intent = notificationIn(prisma);
    assert.equal(intent?.type, NOTIFICATION_TYPE.RESULT_UPDATED);
    assert.equal(intent?.dedupeKey, `result-updated:${attempt.id}:1.5`);
  });

  /** A drop that left this student on the same total is not news, so it is not sent as news. */
  it('says nothing when the re-score landed on the same total', async () => {
    const { prisma, attempt, processor } = sitting({
      status: ATTEMPT_STATUS.EVALUATED,
      evaluatedAt: new Date('2026-08-01T05:00:00.000Z'),
      score: 1.5,
    });

    await processor.score(attempt.id);

    assert.equal(notificationIn(prisma), undefined);
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

  const marksOf = (attempt: FakeAttemptRow, served: FakeServedAnswerRow[]) => ({
    status: attempt.status,
    score: attempt.score,
    correctCount: attempt.correctCount,
    wrongCount: attempt.wrongCount,
    unattemptedCount: attempt.unattemptedCount,
    sectionScores: attempt.sectionScores,
    timeTakenSec: attempt.timeTakenSec,
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

    rowAt(served, 1).paperItem = {
      marks: 2,
      negativeMarks: 0.5,
      status: PAPER_QUESTION_STATUS.DROPPED,
    };
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
    rowAt(served).paperItem = null;

    await processor.score(attempt.id);

    assert.equal(served[0]?.marksAwarded, 0);
    assert.equal(attempt.score, -0.5);
  });
});
