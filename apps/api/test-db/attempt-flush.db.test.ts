import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { ANSWER_STATE, ATTEMPT_STATUS, type AttemptStatus } from '@iace/contracts';
import { AttemptFlushProcessor } from '../src/attempts/attempt-flush.processor';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import { FakeRedis, fakeQueueFailures } from '../test/support/fakes';
import { makePaper, makeStudent, resetDatabase, sitPaper, testPrisma } from './support/database';

const ENDS_AT = new Date('2026-09-01T05:30:00.000Z');
const NOW = new Date('2026-09-01T05:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** One untouched sitting of a one-question paper, open in Redis, with one answer saved unless told not to. */
async function build(status: AttemptStatus = ATTEMPT_STATUS.IN_PROGRESS, saved = true) {
  const paper = await makePaper(prisma, { questions: ['Reasoning'] });
  const studentId = (await makeStudent(prisma)).id;
  const attempt = await sitPaper(prisma, {
    paper,
    studentId,
    chosen: [null],
    timeSpent: [0],
    status,
    submittedAt: null,
  });
  const questionId = paper.items[0]?.questionId ?? '';
  const state = new AttemptStateService(prisma, new FakeRedis().asService());
  await state.open({
    id: attempt.id,
    studentId,
    testId: paper.testId,
    startedAt: new Date(ENDS_AT.getTime() - HOUR_MS),
    endsAt: ENDS_AT,
  });
  if (saved) {
    const answer = {
      questionId,
      state: ANSWER_STATE.ANSWERED,
      selectedOptionId: 'o1',
      typedAnswer: null,
      timeSpentSec: 12,
    };
    await state.save(studentId, attempt.id, { revision: 1, answers: [answer] }, NOW);
  }

  return {
    attemptId: attempt.id,
    state,
    row: () =>
      prisma.attemptQuestion.findUniqueOrThrow({
        where: { attemptId_questionId: { attemptId: attempt.id, questionId } },
      }),
    processor: new AttemptFlushProcessor(prisma, state, fakeQueueFailures()),
  };
}

describe('AttemptFlushProcessor', () => {
  it('writes what Redis holds into the durable row, and clears the mark', async () => {
    const { processor, state, row } = await build();

    await processor.process();

    const written = await row();
    assert.equal(written.selectedOptionId, 'o1');
    assert.equal(written.state, ANSWER_STATE.ANSWERED);
    assert.equal(written.timeSpentSec, 12);
    assert.deepEqual(written.answeredAt, NOW);
    assert.deepEqual(await state.dirtyIds(), []);
  });

  /** It is a repeatable job, so it WILL run over state nothing has changed. */
  it('changes nothing the second time it runs over the same state', async () => {
    const { processor, row } = await build();

    await processor.process();
    const once = await row();
    await processor.process();

    assert.deepEqual(await row(), once);
  });

  it('writes nothing when no attempt is dirty', async () => {
    const { processor, row } = await build(ATTEMPT_STATUS.IN_PROGRESS, false);

    await processor.process();

    assert.equal((await row()).state, ANSWER_STATE.NOT_VISITED);
  });

  /** Submit flushes before it flips the status, so anything finished is already durable. */
  it('skips an attempt that has been submitted, and drops its mark', async () => {
    const { processor, state, row } = await build(ATTEMPT_STATUS.SUBMITTED);

    await processor.process();

    assert.equal((await row()).state, ANSWER_STATE.NOT_VISITED);
    assert.deepEqual(await state.dirtyIds(), []);
  });

  it('drops the mark for a sitting whose state has expired', async () => {
    const { processor, state, attemptId } = await build();
    await state.take(attemptId);
    await state.dirtyIds();

    await processor.process();

    assert.deepEqual(await state.dirtyIds(), []);
  });
});
