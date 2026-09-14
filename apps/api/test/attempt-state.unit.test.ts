import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANSWER_STATE, type AnswerChange } from '@iace/contracts';
import {
  applyBatch,
  isInTime,
  isStale,
  SAVE_GRACE_SEC,
  stateOf,
  type HeldState,
} from '../src/attempts/attempt-state';

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

  /** A first touch happens once: a later save carrying a later stamp must not move it. */
  it('keeps the earliest first action, whichever save carries it', () => {
    const first = applyBatch(held(), {
      revision: 1,
      answers: [change({ firstActionAt: '2026-09-01T05:00:20.000Z' })],
    });
    const later = applyBatch(first, {
      revision: 2,
      answers: [change({ firstActionAt: '2026-09-01T05:09:00.000Z' })],
    });

    assert.equal(later.answers.q1?.firstActionAt, '2026-09-01T05:00:20.000Z');
  });

  /** A reloaded screen re-stamps from when IT opened the question; the older stamp still wins. */
  it('takes an earlier first action from a later save', () => {
    const first = applyBatch(held(), {
      revision: 1,
      answers: [change({ firstActionAt: '2026-09-01T05:09:00.000Z' })],
    });
    const earlier = applyBatch(first, {
      revision: 2,
      answers: [change({ firstActionAt: '2026-09-01T05:00:20.000Z' })],
    });

    assert.equal(earlier.answers.q1?.firstActionAt, '2026-09-01T05:00:20.000Z');
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
