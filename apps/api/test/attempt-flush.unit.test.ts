import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANSWER_STATE,
  ATTEMPT_STATUS,
  type AnswerChange,
  type AttemptStatus,
} from '@iace/contracts';
import { rowsToFlush } from '../src/attempts/attempt-flush';
import { AttemptFlushProcessor } from '../src/attempts/attempt-flush.processor';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import {
  FakeRedis,
  FakeTestsPrisma,
  makeAttempt,
  makeBaseConfig,
  makeSection,
  makeTest,
} from './support/fakes';

const ENDS_AT = new Date('2026-09-01T05:30:00.000Z');
const NOW = new Date('2026-09-01T05:00:00.000Z');

const change = (over: Partial<AnswerChange> = {}): AnswerChange => ({
  questionId: 'q1',
  state: ANSWER_STATE.ANSWERED,
  selectedOptionId: 'opt_a',
  typedAnswer: null,
  timeSpentSec: 12,
  ...over,
});

function build(status: AttemptStatus = ATTEMPT_STATUS.IN_PROGRESS) {
  const prisma = new FakeTestsPrisma(
    [makeTest({ id: 'tst_1' })],
    [makeBaseConfig({ id: 'cfg_1' })],
    [makeSection({ id: 'sec_1', baseConfigId: 'cfg_1' })],
    [],
    [],
    [],
    [],
    [makeAttempt({ id: 'att_1', studentId: 'stu_1', endsAt: ENDS_AT, status })],
    [
      {
        attemptId: 'att_1',
        questionId: 'q1',
        paperQuestionId: 'pq_1',
        questionVersionId: 'q1_v1',
        baseConfigSectionId: 'sec_1',
        order: 1,
        state: ANSWER_STATE.NOT_VISITED,
        selectedOptionId: null,
        typedAnswer: null,
        timeSpentSec: 0,
      },
    ],
  );
  const redis = new FakeRedis();
  const state = new AttemptStateService(prisma.asService(), redis.asService());
  return { prisma, state, processor: new AttemptFlushProcessor(prisma.asService(), state) };
}

describe('rowsToFlush', () => {
  const held = {
    attemptId: 'att_1',
    studentId: 'stu_1',
    endsAt: ENDS_AT.toISOString(),
    revision: 2,
    sections: {},
    answers: {
      q1: {
        state: ANSWER_STATE.ANSWERED,
        selectedOptionId: 'opt_a',
        typedAnswer: null,
        timeSpentSec: 40,
        answeredAt: '2026-09-01T05:01:00.000Z',
      },
      q2: {
        state: ANSWER_STATE.NOT_ANSWERED,
        selectedOptionId: null,
        typedAnswer: null,
        timeSpentSec: 8,
        answeredAt: null,
      },
    },
  };

  it('writes a row per question the sitting has touched', () => {
    const rows = rowsToFlush(held);

    assert.deepEqual(rows.map((row) => row.questionId).sort(), ['q1', 'q2']);
  });

  /** The failure this prevents: a repeatable job rewriting answeredAt every minute it runs. */
  it('takes every value off the state and none off the clock', () => {
    const first = rowsToFlush(held);
    const second = rowsToFlush(held);

    assert.deepEqual(first, second);
    assert.deepEqual(first[0]?.data.answeredAt, new Date('2026-09-01T05:01:00.000Z'));
  });

  it('leaves an unanswered question with no answered time', () => {
    const rows = rowsToFlush(held);
    const unanswered = rows.find((row) => row.questionId === 'q2');

    assert.equal(unanswered?.data.answeredAt, null);
    assert.equal(unanswered?.data.state, ANSWER_STATE.NOT_ANSWERED);
  });
});

describe('AttemptFlushProcessor', () => {
  it('writes what Redis holds into the durable row, and clears the mark', async () => {
    const { processor, state, prisma } = build();
    await state.open({ id: 'att_1', studentId: 'stu_1', endsAt: ENDS_AT });
    await state.save('stu_1', 'att_1', { revision: 1, answers: [change()] }, NOW);

    await processor.process();

    const row = prisma.attemptQuestions[0];
    assert.equal(row?.selectedOptionId, 'opt_a');
    assert.equal(row?.state, ANSWER_STATE.ANSWERED);
    assert.equal(row?.timeSpentSec, 12);
    assert.deepEqual(row?.answeredAt, NOW);
    assert.deepEqual(await state.dirtyIds(), []);
  });

  /** It is a repeatable job, so it WILL run over state nothing has changed. */
  it('changes nothing the second time it runs over the same state', async () => {
    const { processor, state, prisma } = build();
    await state.open({ id: 'att_1', studentId: 'stu_1', endsAt: ENDS_AT });
    await state.save('stu_1', 'att_1', { revision: 1, answers: [change()] }, NOW);

    await processor.process();
    const after = JSON.stringify(prisma.attemptQuestions);
    await processor.process();

    assert.equal(JSON.stringify(prisma.attemptQuestions), after);
  });

  it('writes nothing when no attempt is dirty', async () => {
    const { processor, prisma } = build();

    await processor.process();

    assert.equal(prisma.attemptQuestions[0]?.state, ANSWER_STATE.NOT_VISITED);
  });

  /** Submit flushes before it flips the status, so anything finished is already durable. */
  it('skips an attempt that has been submitted, and drops its mark', async () => {
    const { processor, state, prisma } = build(ATTEMPT_STATUS.SUBMITTED);
    await state.open({ id: 'att_1', studentId: 'stu_1', endsAt: ENDS_AT });
    await state.save('stu_1', 'att_1', { revision: 1, answers: [change()] }, NOW);

    await processor.process();

    assert.equal(prisma.attemptQuestions[0]?.state, ANSWER_STATE.NOT_VISITED);
    assert.deepEqual(await state.dirtyIds(), []);
  });

  it('drops the mark for a sitting whose state has expired', async () => {
    const { processor, state } = build();
    await state.open({ id: 'att_1', studentId: 'stu_1', endsAt: ENDS_AT });
    await state.save('stu_1', 'att_1', { revision: 1, answers: [change()] }, NOW);
    await state.take('att_1');
    await state.dirtyIds();

    await processor.process();

    assert.deepEqual(await state.dirtyIds(), []);
  });
});
