import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANSWER_STATE, QUESTION_TIME_MAX_SEC, answerChangeSchema } from '../src/index';

const change = (over: Record<string, unknown> = {}) => ({
  questionId: 'q1',
  state: ANSWER_STATE.ANSWERED,
  selectedOptionId: 'o1',
  typedAnswer: null,
  timeSpentSec: 42,
  firstActionAt: '2026-09-01T05:00:30.000Z',
  ...over,
});

describe('answerChangeSchema', () => {
  it('accepts the change a test screen sends', () => {
    assert.equal(answerChangeSchema.safeParse(change()).success, true);
    assert.equal(answerChangeSchema.safeParse(change({ firstActionAt: null })).success, true);
  });

  /** The failure this prevents: a crafted instant no sheet can place, failing that sitting's scoring forever. */
  it('refuses a first touch that is not a UTC instant', () => {
    for (const firstActionAt of ['yesterday', '+275760-09-13T00:00:00.000Z', '2026-09-01']) {
      assert.equal(answerChangeSchema.safeParse(change({ firstActionAt })).success, false);
    }
  });

  it('refuses more seconds on one question than a day holds', () => {
    const over = change({ timeSpentSec: QUESTION_TIME_MAX_SEC + 1 });

    assert.equal(answerChangeSchema.safeParse(over).success, false);
    assert.equal(
      answerChangeSchema.safeParse(change({ timeSpentSec: QUESTION_TIME_MAX_SEC })).success,
      true,
    );
  });
});
