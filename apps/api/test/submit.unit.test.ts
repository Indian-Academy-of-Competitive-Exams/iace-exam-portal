import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANSWER_STATE,
  AppException,
  ATTEMPT_STATUS,
  ErrorCodes,
  type AnswerChange,
  type AttemptStatus,
} from '@iace/contracts';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import { AttemptSweeperProcessor } from '../src/attempts/attempt-sweeper.processor';
import { SubmitService } from '../src/attempts/submit.service';
import { QUEUE_NAMES } from '../src/queue/queues';
import {
  FakeRedis,
  FakeTestsPrisma,
  makeAttempt,
  makeBaseConfig,
  makeSection,
  makeTest,
} from './support/fakes';

const NOW = new Date('2026-09-01T05:00:00.000Z');
const ENDS_AT = new Date('2026-09-01T05:30:00.000Z');

const change = (over: Partial<AnswerChange> = {}): AnswerChange => ({
  questionId: 'q1',
  state: ANSWER_STATE.ANSWERED,
  selectedOptionId: 'opt_a',
  typedAnswer: null,
  timeSpentSec: 30,
  ...over,
});

/** Records what was enqueued, which is the whole of what submit asks of Phase 4. */
class FakeQueue {
  readonly jobs: { name: string; data: unknown }[] = [];

  add(name: string, data: unknown): Promise<void> {
    this.jobs.push({ name, data });
    return Promise.resolve();
  }
}

function build(over: { endsAt?: Date; status?: AttemptStatus } = {}) {
  const prisma = new FakeTestsPrisma(
    [makeTest({ id: 'tst_1' })],
    [makeBaseConfig({ id: 'cfg_1' })],
    [makeSection({ id: 'sec_1', baseConfigId: 'cfg_1' })],
    [],
    [],
    [],
    [],
    [],
    [
      makeAttempt({
        id: 'att_1',
        studentId: 'stu_1',
        testId: 'tst_1',
        endsAt: over.endsAt ?? ENDS_AT,
        status: over.status ?? ATTEMPT_STATUS.IN_PROGRESS,
      }),
    ],
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
  const queue = new FakeQueue();
  const submit = new SubmitService(prisma.asService(), state, queue as never);
  return {
    prisma,
    state,
    queue,
    submit,
    sweeper: new AttemptSweeperProcessor(prisma.asService(), submit),
  };
}

const answered = async (state: AttemptStateService) => {
  await state.open({ id: 'att_1', studentId: 'stu_1', endsAt: ENDS_AT });
  await state.save('stu_1', 'att_1', { revision: 1, answers: [change()] }, NOW);
};

describe('SubmitService', () => {
  it('writes what Redis held, ends the sitting, and enqueues one scoring job', async () => {
    const { submit, state, prisma, queue } = build();
    await answered(state);

    const result = await submit.submit('stu_1', 'att_1');

    assert.equal(result.submittedByThisCall, true);
    assert.equal(result.status, ATTEMPT_STATUS.SUBMITTED);
    assert.equal(result.answeredCount, 1);
    assert.equal(prisma.attemptQuestions[0]?.selectedOptionId, 'opt_a');
    assert.equal(prisma.attemptRows[0]?.status, ATTEMPT_STATUS.SUBMITTED);
    assert.deepEqual(queue.jobs, [
      { name: QUEUE_NAMES.SCORING, data: { attemptId: 'att_1', testId: 'tst_1' } },
    ]);
  });

  /** The failure this prevents: a double-click scoring one sitting twice. */
  it('reports the first outcome on a second submit, and enqueues nothing more', async () => {
    const { submit, state, queue } = build();
    await answered(state);

    const first = await submit.submit('stu_1', 'att_1');
    const second = await submit.submit('stu_1', 'att_1');

    assert.equal(second.submittedByThisCall, false);
    assert.equal(second.submittedAt, first.submittedAt);
    assert.equal(queue.jobs.length, 1);
  });

  /** Taking the state shuts the door: nothing can be saved into a sitting that has ended. */
  it('leaves no live state behind, so a later save is refused', async () => {
    const { submit, state } = build();
    await answered(state);

    await submit.submit('stu_1', 'att_1');

    assert.equal(await state.read('att_1'), null);
    const error = await state
      .save('stu_1', 'att_1', { revision: 9, answers: [change()] }, NOW)
      .catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
  });

  it('submits an empty paper for a student who answered nothing', async () => {
    const { submit, state, prisma } = build();
    await state.open({ id: 'att_1', studentId: 'stu_1', endsAt: ENDS_AT });

    const result = await submit.submit('stu_1', 'att_1');

    assert.equal(result.answeredCount, 0);
    assert.equal(prisma.attemptRows[0]?.status, ATTEMPT_STATUS.SUBMITTED);
  });

  it('refuses another student with NOT_FOUND, not FORBIDDEN', async () => {
    const { submit, state } = build();
    await answered(state);

    const error = await submit.submit('stu_2', 'att_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });
});

describe('AttemptSweeperProcessor', () => {
  const LATE = new Date(Date.now() - 60 * 60 * 1000);

  it('ends a sitting whose clock ran out', async () => {
    const { sweeper, state, prisma, queue } = build({ endsAt: LATE });
    await state.open({ id: 'att_1', studentId: 'stu_1', endsAt: LATE });

    await sweeper.process();

    assert.equal(prisma.attemptRows[0]?.status, ATTEMPT_STATUS.SUBMITTED);
    assert.equal(queue.jobs.length, 1);
  });

  /** The grace a save gets is the grace the sweeper gives: it must not end one still reachable. */
  it('leaves a sitting still inside its clock alone', async () => {
    const { sweeper, prisma } = build({ endsAt: new Date(Date.now() + 60 * 60 * 1000) });

    await sweeper.process();

    assert.equal(prisma.attemptRows[0]?.status, ATTEMPT_STATUS.IN_PROGRESS);
  });

  /** The failure this prevents: a sweep and a student's own submit both scoring the same sitting. */
  it('produces one submission when it races a manual submit', async () => {
    const { sweeper, submit, state, queue, prisma } = build({ endsAt: LATE });
    await state.open({ id: 'att_1', studentId: 'stu_1', endsAt: LATE });

    await Promise.all([sweeper.process(), submit.submit('stu_1', 'att_1')]);

    assert.equal(prisma.attemptRows[0]?.status, ATTEMPT_STATUS.SUBMITTED);
    assert.equal(queue.jobs.length, 1);
  });

  it('has nothing to do twice over', async () => {
    const { sweeper, state, queue } = build({ endsAt: LATE });
    await state.open({ id: 'att_1', studentId: 'stu_1', endsAt: LATE });

    await sweeper.process();
    await sweeper.process();

    assert.equal(queue.jobs.length, 1);
  });
});
