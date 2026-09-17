import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { ANSWER_STATE, ATTEMPT_STATUS, type AttemptStatus } from '@iace/contracts';
import { AttemptFlushProcessor } from '../src/attempts/attempt-flush.processor';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import { FakeRedis, fakeQueueFailures } from '../test/support/fakes';
import { AttemptSheetService } from '../src/attempts/attempt-sheet.service';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import {
  makePaper,
  makeStudent,
  resetDatabase,
  servedAnswers,
  sitPaper,
  testPrisma,
} from './support/database';

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
  const startedAt = new Date(ENDS_AT.getTime() - HOUR_MS);
  const attempt = await sitPaper(prisma, {
    paper,
    studentId,
    chosen: [null],
    timeSpent: [0],
    status,
    startedAt,
    submittedAt: null,
  });
  const questionId = paper.items[0]?.questionId ?? '';
  const state = new AttemptStateService(prisma, new FakeRedis().asService());
  await state.open({
    id: attempt.id,
    studentId,
    testId: paper.testId,
    startedAt,
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
    startedAt,
    state,
    processor: new AttemptFlushProcessor(
      state,
      new AttemptSheetService(prisma, new PaperSheetService(prisma)),
      fakeQueueFailures(),
    ),
  };
}

describe('AttemptFlushProcessor', () => {
  it('writes what Redis holds into the sitting’s sheet, and clears the mark', async () => {
    const { processor, state, attemptId, startedAt } = await build();

    await processor.process();

    assert.deepEqual(await state.dirtyIds(), []);
    const [onSheet] = await servedAnswers(prisma, attemptId);
    // The sheet stores whole seconds after startedAt, so what it reports back is NOW truncated to the second.
    const flushedAt = new Date(
      startedAt.getTime() + Math.floor((NOW.getTime() - startedAt.getTime()) / 1000) * 1000,
    );
    assert.deepEqual(
      [onSheet?.state, onSheet?.selectedOptionId, onSheet?.timeSpentSec, onSheet?.answeredAt],
      [ANSWER_STATE.ANSWERED, 'o1', 12, flushedAt],
    );
  });

  /** It is a repeatable job, so it WILL run over state nothing has changed. */
  it('changes nothing the second time it runs over the same state', async () => {
    const { processor, attemptId } = await build();

    await processor.process();
    const once = await servedAnswers(prisma, attemptId);
    await processor.process();

    assert.deepEqual(await servedAnswers(prisma, attemptId), once);
  });

  it('writes nothing when no attempt is dirty', async () => {
    const { processor, attemptId } = await build(ATTEMPT_STATUS.IN_PROGRESS, false);

    await processor.process();

    const [onSheet] = await servedAnswers(prisma, attemptId);
    assert.equal(onSheet?.state, ANSWER_STATE.NOT_VISITED);
  });

  /** Submit flushes before it flips the status, so anything finished is already durable. */
  it('skips an attempt that has been submitted, and drops its mark', async () => {
    const { processor, state, attemptId } = await build(ATTEMPT_STATUS.SUBMITTED);

    await processor.process();

    const [onSheet] = await servedAnswers(prisma, attemptId);
    assert.equal(onSheet?.state, ANSWER_STATE.NOT_VISITED);
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
