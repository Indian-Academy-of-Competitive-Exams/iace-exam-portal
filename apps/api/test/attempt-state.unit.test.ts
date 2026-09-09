import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANSWER_STATE, AppException, ErrorCodes, type AnswerChange } from '@iace/contracts';
import {
  applyBatch,
  isInTime,
  isStale,
  SAVE_GRACE_SEC,
  stateOf,
  type HeldState,
} from '../src/attempts/attempt-state';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import {
  FakeRedis,
  FakeTestsPrisma,
  makeAttempt,
  makeBaseConfig,
  makeSection,
  makeTest,
} from './support/fakes';

const ENDS_AT = '2026-09-01T05:30:00.000Z';

const held = (over: Partial<HeldState> = {}): HeldState => ({
  attemptId: 'att_1',
  studentId: 'stu_1',
  endsAt: ENDS_AT,
  revision: 0,
  answers: {},
  sections: {},
  ...over,
});

const change = (over: Partial<AnswerChange> = {}): AnswerChange => ({
  questionId: 'q1',
  state: ANSWER_STATE.ANSWERED,
  selectedOptionId: 'opt_a',
  typedAnswer: null,
  timeSpentSec: 10,
  ...over,
});

describe('stateOf — the truth table the bottom bar can produce', () => {
  it('is ANSWERED when an option is chosen and it is not marked', () => {
    assert.equal(stateOf(change()), ANSWER_STATE.ANSWERED);
  });

  /** Marking keeps the answer: it is a flag on top of one, not a state instead of one. */
  it('is ANSWERED_MARKED when a chosen answer is also marked', () => {
    assert.equal(
      stateOf(change({ state: ANSWER_STATE.MARKED_REVIEW })),
      ANSWER_STATE.ANSWERED_MARKED,
    );
  });

  it('is MARKED_REVIEW when it is marked with nothing chosen', () => {
    const marked = change({ state: ANSWER_STATE.MARKED_REVIEW, selectedOptionId: null });

    assert.equal(stateOf(marked), ANSWER_STATE.MARKED_REVIEW);
  });

  /** The failure this prevents: Clear Response leaving a question counted as answered. */
  it('returns a cleared response to NOT_ANSWERED, never to NOT_VISITED', () => {
    const cleared = change({ state: ANSWER_STATE.ANSWERED, selectedOptionId: null });

    assert.equal(stateOf(cleared), ANSWER_STATE.NOT_ANSWERED);
  });

  it('keeps a question nobody has opened at NOT_VISITED', () => {
    const unseen = change({ state: ANSWER_STATE.NOT_VISITED, selectedOptionId: null });

    assert.equal(stateOf(unseen), ANSWER_STATE.NOT_VISITED);
  });

  it('reads whitespace as no answer at all', () => {
    const blank = change({
      state: ANSWER_STATE.ANSWERED,
      selectedOptionId: null,
      typedAnswer: '  ',
    });

    assert.equal(stateOf(blank), ANSWER_STATE.NOT_ANSWERED);
  });

  /** A client claiming ANSWERED with nothing chosen must not be able to make it so. */
  it('does not take the screen at its word', () => {
    const lying = change({ state: ANSWER_STATE.ANSWERED_MARKED, selectedOptionId: null });

    assert.equal(stateOf(lying), ANSWER_STATE.MARKED_REVIEW);
  });
});

describe('applyBatch', () => {
  it('writes an answer the held state did not have', () => {
    const next = applyBatch(held(), { revision: 1, answers: [change()] });

    assert.equal(next.answers.q1?.state, ANSWER_STATE.ANSWERED);
    assert.equal(next.answers.q1?.selectedOptionId, 'opt_a');
    assert.equal(next.revision, 1);
  });

  /** The failure this prevents: a cleared answer scored later from an option nobody chose. */
  it('drops the option when the answer is cleared', () => {
    const first = applyBatch(held(), { revision: 1, answers: [change()] });
    const cleared = applyBatch(first, {
      revision: 2,
      answers: [change({ selectedOptionId: null, timeSpentSec: 20 })],
    });

    assert.equal(cleared.answers.q1?.selectedOptionId, null);
    assert.equal(cleared.answers.q1?.state, ANSWER_STATE.NOT_ANSWERED);
  });

  /** Time is a TOTAL: a screen that reloads and counts from zero must not shorten the record. */
  it('never lets time spent go backwards', () => {
    const first = applyBatch(held(), { revision: 1, answers: [change({ timeSpentSec: 90 })] });
    const second = applyBatch(first, { revision: 2, answers: [change({ timeSpentSec: 5 })] });

    assert.equal(second.answers.q1?.timeSpentSec, 90);
  });

  it('leaves questions the batch does not mention alone', () => {
    const first = applyBatch(held(), { revision: 1, answers: [change()] });
    const second = applyBatch(first, {
      revision: 2,
      answers: [change({ questionId: 'q2', selectedOptionId: 'opt_b' })],
    });

    assert.equal(second.answers.q1?.selectedOptionId, 'opt_a');
    assert.equal(second.answers.q2?.selectedOptionId, 'opt_b');
  });

  /** The failure this prevents: a retried save undoing the answer that overtook it. */
  it('drops a batch that has been overtaken', () => {
    const first = applyBatch(held(), {
      revision: 4,
      answers: [change({ selectedOptionId: 'opt_a' })],
    });
    const late = applyBatch(first, {
      revision: 3,
      answers: [change({ selectedOptionId: 'opt_z' })],
    });

    assert.equal(late.answers.q1?.selectedOptionId, 'opt_a');
    assert.equal(late.revision, 4);
    assert.equal(isStale(first, { revision: 3, answers: [] }), true);
    assert.equal(isStale(first, { revision: 5, answers: [] }), false);
  });

  it('merges section clocks without dropping the ones it does not carry', () => {
    const first = applyBatch(held(), {
      revision: 1,
      answers: [],
      sections: { sec_1: { remainingSec: 100, closed: false } },
    });
    const second = applyBatch(first, {
      revision: 2,
      answers: [],
      sections: { sec_2: { remainingSec: 500, closed: false } },
    });

    assert.equal(second.sections.sec_1?.remainingSec, 100);
    assert.equal(second.sections.sec_2?.remainingSec, 500);
  });
});

describe('isInTime', () => {
  const at = (iso: string) => new Date(iso);

  it('takes a save inside the sitting', () => {
    assert.equal(isInTime(held(), at('2026-09-01T05:29:59.000Z')), true);
  });

  /** A request in flight as the clock expires is not cheating. */
  it('takes one that lands inside the grace', () => {
    assert.equal(isInTime(held(), at('2026-09-01T05:30:20.000Z')), true);
    assert.equal(SAVE_GRACE_SEC, 30);
  });

  it('refuses one past the grace', () => {
    assert.equal(isInTime(held(), at('2026-09-01T05:30:31.000Z')), false);
  });
});

describe('AttemptStateService', () => {
  const build = () => {
    const prisma = new FakeTestsPrisma(
      [makeTest({ id: 'tst_1' })],
      [makeBaseConfig({ id: 'cfg_1' })],
      [makeSection({ id: 'sec_1', baseConfigId: 'cfg_1' })],
      [],
      [],
      [],
      [],
      [makeAttempt({ id: 'att_1', studentId: 'stu_1', endsAt: new Date(ENDS_AT) })],
      [],
    );
    const redis = new FakeRedis();
    return { redis, service: new AttemptStateService(prisma.asService(), redis.asService()) };
  };

  /** One answer already flushed to Postgres, which is what a lost key is put back from. */
  const buildWithDurable = () => {
    const prisma = new FakeTestsPrisma(
      [makeTest({ id: 'tst_1' })],
      [makeBaseConfig({ id: 'cfg_1' })],
      [makeSection({ id: 'sec_1', baseConfigId: 'cfg_1' })],
      [],
      [],
      [],
      [],
      [makeAttempt({ id: 'att_1', studentId: 'stu_1', endsAt: new Date(ENDS_AT) })],
      [
        {
          attemptId: 'att_1',
          questionId: 'q1',
          paperQuestionId: 'pq_1',
          questionVersionId: 'q1_v1',
          baseConfigSectionId: 'sec_1',
          order: 1,
          selectedOptionId: 'opt_a',
          typedAnswer: null,
          state: ANSWER_STATE.ANSWERED,
          timeSpentSec: 20,
          answeredAt: new Date('2026-09-01T05:01:00.000Z'),
        },
      ],
    );
    const redis = new FakeRedis();
    return {
      prisma,
      redis,
      service: new AttemptStateService(prisma.asService(), redis.asService()),
    };
  };

  const now = new Date('2026-09-01T05:00:00.000Z');

  it('saves to Redis and marks the attempt dirty', async () => {
    const { service, redis } = build();
    await service.open({ id: 'att_1', studentId: 'stu_1', endsAt: new Date(ENDS_AT) });

    const state = await service.save('stu_1', 'att_1', { revision: 1, answers: [change()] }, now);

    assert.equal(state.answers.q1?.state, ANSWER_STATE.ANSWERED);
    assert.deepEqual(await service.dirtyIds(), ['att_1']);
    assert.ok(redis.snapshot()['attempt:state:att_1']);
  });

  /** An id is not a thing to confirm the existence of, so another student's reads as missing. */
  it('refuses another student with NOT_FOUND, not FORBIDDEN', async () => {
    const { service } = build();
    await service.open({ id: 'att_1', studentId: 'stu_1', endsAt: new Date(ENDS_AT) });

    const error = await service
      .save('stu_2', 'att_1', { revision: 1, answers: [] }, now)
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  it('refuses a save that arrives after the clock and its grace', async () => {
    const { service } = build();
    await service.open({ id: 'att_1', studentId: 'stu_1', endsAt: new Date(ENDS_AT) });

    const error = await service
      .save('stu_1', 'att_1', { revision: 1, answers: [] }, new Date('2026-09-01T06:00:00.000Z'))
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
  });

  /** Taking the state is what ends a sitting: with the key gone, Postgres refuses what is not live. */
  it('refuses a save once the sitting has been taken', async () => {
    const { service } = build();
    await service.open({ id: 'att_1', studentId: 'stu_1', endsAt: new Date(ENDS_AT) });
    await service.save('stu_1', 'att_1', { revision: 1, answers: [change()] }, now);

    await service.take('att_1');

    assert.deepEqual(await service.dirtyIds(), []);
    const rebuilt = await service.save('stu_1', 'att_1', { revision: 2, answers: [] }, now);
    assert.equal(Object.keys(rebuilt.answers).length, 0);
  });

  /** The failure this prevents: a support reset handing the student back an empty paper. */
  it('puts a lost live key back from the answers already written', async () => {
    const { service, prisma } = buildWithDurable();

    const rebuilt = await service.reestablish('stu_1', 'att_1');

    assert.equal(prisma.attemptQuestions.length, 1);
    assert.equal(rebuilt.answers.q1?.state, ANSWER_STATE.ANSWERED);
    assert.equal(rebuilt.answers.q1?.selectedOptionId, 'opt_a');
  });

  /** The key holds what landed since the last flush, so a reset must not roll the student back. */
  it('keeps whatever the key still holds over the durable copy', async () => {
    const { service } = buildWithDurable();
    await service.open({ id: 'att_1', studentId: 'stu_1', endsAt: new Date(ENDS_AT) });
    await service.save(
      'stu_1',
      'att_1',
      { revision: 4, answers: [change({ questionId: 'q2' })] },
      now,
    );

    const rebuilt = await service.reestablish('stu_1', 'att_1');

    assert.equal(rebuilt.revision, 4);
    assert.deepEqual(Object.keys(rebuilt.answers).sort(), ['q1', 'q2']);
  });

  /** The bug this prevents: an extension rewriting the whole key and dropping the last autosave. */
  it('moves the deadline without touching what the sitting has answered', async () => {
    const { service, redis } = build();
    await service.open({ id: 'att_1', studentId: 'stu_1', endsAt: new Date(ENDS_AT) });
    await service.save('stu_1', 'att_1', { revision: 1, answers: [change()] }, now);

    const later = new Date('2026-09-01T06:00:00.000Z');
    await service.pushDeadline('att_1', later);

    const state = await service.current('stu_1', 'att_1', now);
    assert.equal(state.endsAt, later.toISOString());
    assert.equal(state.revision, 1);
    assert.equal(state.answers.q1?.state, ANSWER_STATE.ANSWERED);
    assert.ok(redis.snapshot()['attempt:state:att_1']);
  });

  /** No key is no clock to move: the row carries the new deadline, and a rebuild reads it there. */
  it('does nothing to a deadline whose live key has gone', async () => {
    const { service } = build();

    await service.pushDeadline('att_1', new Date('2026-09-01T06:00:00.000Z'));

    assert.deepEqual(await service.read('att_1'), null);
  });

  it('leaves the answers of a resumed sitting alone', async () => {
    const { service } = build();
    await service.open({ id: 'att_1', studentId: 'stu_1', endsAt: new Date(ENDS_AT) });
    await service.save('stu_1', 'att_1', { revision: 1, answers: [change()] }, now);

    await service.open({ id: 'att_1', studentId: 'stu_1', endsAt: new Date(ENDS_AT) });

    const state = await service.read('att_1');
    assert.equal(state?.answers.q1?.selectedOptionId, 'opt_a');
  });

  describe('reading a sitting back', () => {
    const now = new Date('2026-09-01T05:00:00.000Z');

    /** The bug this prevents: a mid-test reload showing a blank palette while the answers are safe. */
    it('returns what the sitting holds, without changing it', async () => {
      const { service } = build();
      await service.save('stu_1', 'att_1', { revision: 1, answers: [change()] }, now);

      const shown = await service.current('stu_1', 'att_1', now);

      assert.equal(shown.answers['q1']?.state, ANSWER_STATE.ANSWERED);
      assert.equal(shown.answers['q1']?.selectedOptionId, 'opt_a');
      assert.equal(shown.revision, 1, 'reading must not move the revision on');
    });

    it("reads another student's sitting as missing, never as refused", async () => {
      const { service } = build();
      await service.save('stu_1', 'att_1', { revision: 1, answers: [change()] }, now);

      await assert.rejects(
        () => service.current('stu_2', 'att_1', now),
        (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
      );
    });
  });
});
