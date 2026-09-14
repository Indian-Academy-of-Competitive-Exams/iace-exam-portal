import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ATTEMPT_STATUS,
  NOTIFICATION_TYPE,
  PAPER_QUESTION_STATUS,
  type AttemptSectionScore,
} from '@iace/contracts';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { RollupOutbox } from '../src/attempts/rollup-outbox';
import { NOTIFICATION_REQUEST, NotificationOutbox } from '../src/notifications/notification-outbox';
import { FakeEventBus, FakeQueue, fakeQueueFailures } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makePaper,
  makeStudent,
  resetDatabase,
  sitPaper,
  testPrisma,
  uid,
  type Paper,
  type SitInput,
} from './support/database';

const A_DAY_SEC = 24 * 60 * 60;
const WRONG = 'o2';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const processor = new ScoringProcessor(
  prisma,
  new RollupOutbox(new FakeQueue().asQueue()),
  new FakeEventBus().asService(),
  new NotificationOutbox(prisma, new FakeQueue().asQueue()),
  fakeQueueFailures(),
);

type Sat = Omit<SitInput, 'paper' | 'studentId' | 'chosen'>;

/** Three questions on one paper: the first right, the second wrong, the third never touched. */
async function sitting(over: Sat = {}, paper?: Paper) {
  const onPaper =
    paper ?? (await makePaper(prisma, { questions: ['Reasoning', 'Reasoning', 'Reasoning'] }));
  const student = await makeStudent(prisma);
  const attempt = await sitPaper(prisma, {
    paper: onPaper,
    studentId: student.id,
    chosen: [RIGHT_OPTION, WRONG, null],
    ...over,
  });
  return { paper: onPaper, attemptId: attempt.id };
}

const attemptRow = (id: string) => prisma.attempt.findUniqueOrThrow({ where: { id } });

const served = (attemptId: string) =>
  prisma.attemptQuestion.findMany({ where: { attemptId }, orderBy: { order: 'asc' } });

const notificationIn = async () => {
  const [row] = await prisma.outboxEvent.findMany({
    where: { eventType: NOTIFICATION_REQUEST.EVENT_TYPE },
  });
  return row?.payload as Record<string, unknown> | undefined;
};

const marks = async (attemptId: string) =>
  (await served(attemptId)).map((row) => [row.isCorrect, Number(row.marksAwarded)]);

describe('ScoringProcessor — what it writes', () => {
  it('scores the paper into the sitting and into every question it served', async () => {
    const { attemptId } = await sitting();

    await processor.score(attemptId);

    const attempt = await attemptRow(attemptId);
    assert.equal(attempt.status, ATTEMPT_STATUS.EVALUATED);
    assert.equal(Number(attempt.score), 1.5);
    assert.deepEqual(
      [attempt.correctCount, attempt.wrongCount, attempt.unattemptedCount],
      [1, 1, 1],
    );
    assert.deepEqual(await marks(attemptId), [
      [true, 2],
      [false, -0.5],
      [null, 0],
    ]);
    assert.equal((attempt.sectionScores as AttemptSectionScore[] | null)?.[0]?.score, 1.5);
  });

  it('records the time the sitting took beside its marks, and never more than a day', async () => {
    const paper = await makePaper(prisma, { questions: ['Reasoning', 'Reasoning', 'Reasoning'] });
    const startedAt = new Date('2026-08-24T04:00:00.000Z');
    const runs = [
      await sitting({ startedAt, submittedAt: new Date('2026-08-24T04:20:00.000Z') }, paper),
      await sitting({ startedAt, submittedAt: new Date('2026-08-25T10:00:00.000Z') }, paper),
      await sitting({ startedAt, submittedAt: null }, paper),
    ];

    for (const run of runs) await processor.score(run.attemptId);

    const taken = await Promise.all(
      runs.map(async (run) => (await attemptRow(run.attemptId)).timeTakenSec),
    );
    assert.deepEqual(taken, [20 * 60, A_DAY_SEC, A_DAY_SEC]);
  });

  /** A first evaluation is RESULT_READY; only a re-score reaches the correction path at all. */
  it('tells a student whose marks a re-score actually moved', async () => {
    const { attemptId } = await sitting({
      status: ATTEMPT_STATUS.EVALUATED,
      evaluatedAt: new Date('2026-08-01T05:00:00.000Z'),
      score: 0,
    });

    await processor.score(attemptId);

    const intent = await notificationIn();
    assert.equal(intent?.type, NOTIFICATION_TYPE.RESULT_UPDATED);
    assert.equal(intent?.dedupeKey, `result-updated:${attemptId}:1.5`);
  });

  /** A drop that left this student on the same total is not news, so it is not sent as news. */
  it('says nothing when the re-score landed on the same total', async () => {
    const { attemptId } = await sitting({
      status: ATTEMPT_STATUS.EVALUATED,
      evaluatedAt: new Date('2026-08-01T05:00:00.000Z'),
      score: 1.5,
    });

    await processor.score(attemptId);

    assert.equal(await notificationIn(), undefined);
  });

  it('stamps a sitting nobody had stamped, and leaves a stamped one where it was', async () => {
    const stamped = new Date('2026-08-01T05:00:00.000Z');
    const paper = await makePaper(prisma, { questions: ['Reasoning', 'Reasoning', 'Reasoning'] });
    const fresh = await sitting({}, paper);
    const rerun = await sitting({ status: ATTEMPT_STATUS.EVALUATED, evaluatedAt: stamped }, paper);

    await processor.score(fresh.attemptId);
    await processor.score(rerun.attemptId);

    assert.notEqual((await attemptRow(fresh.attemptId)).evaluatedAt, null);
    assert.deepEqual((await attemptRow(rerun.attemptId)).evaluatedAt, stamped);
  });

  it('writes the same marks the second time, so a redelivered job costs nothing', async () => {
    const { attemptId } = await sitting();
    const snapshot = async () => {
      const { updatedAt: _updatedAt, ...attempt } = await attemptRow(attemptId);
      return JSON.stringify({ attempt, questions: await marks(attemptId) });
    };

    await processor.score(attemptId);
    const first = await snapshot();
    await processor.score(attemptId);

    assert.equal(await snapshot(), first);
  });

  it('re-scores an evaluated sitting, which is how a dropped question reaches it', async () => {
    const { paper, attemptId } = await sitting();
    await processor.score(attemptId);

    await prisma.paperQuestion.update({
      where: { id: paper.items[1]?.paperQuestionId ?? '' },
      data: { status: PAPER_QUESTION_STATUS.DROPPED },
    });
    await processor.score(attemptId);

    // The wrong answer is paid rather than penalised: 2 + 2 + 0, not 2 − 0.5 + 0.
    assert.equal(Number((await attemptRow(attemptId)).score), 4);
    const [, dropped] = await served(attemptId);
    assert.equal(Number(dropped?.marksAwarded), 2);
    assert.equal(dropped?.isCorrect, false);
  });

  it('leaves a sitting still being sat alone', async () => {
    const { attemptId } = await sitting({ status: ATTEMPT_STATUS.IN_PROGRESS });

    assert.equal(await processor.score(attemptId), null);
    const attempt = await attemptRow(attemptId);
    assert.equal(attempt.score, null);
    assert.equal(attempt.status, ATTEMPT_STATUS.IN_PROGRESS);
  });

  it('reports an attempt that does not exist rather than throwing at the worker', async () => {
    assert.equal(await processor.score(uid('attempt')), null);
  });

  it('scores a question the paper never priced at nothing, rather than crashing on it', async () => {
    const { paper, attemptId } = await sitting();
    await prisma.attemptQuestion.updateMany({
      where: { attemptId, questionId: paper.items[0]?.questionId ?? '' },
      data: { paperQuestionId: null },
    });

    await processor.score(attemptId);

    const [unpriced] = await served(attemptId);
    assert.equal(Number(unpriced?.marksAwarded), 0);
    assert.equal(Number((await attemptRow(attemptId)).score), -0.5);
  });
});
