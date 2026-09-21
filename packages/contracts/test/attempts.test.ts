import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANSWER_STATE,
  ANSWER_STATES,
  QUESTION_TIME_MAX_SEC,
  answerChangeSchema,
  paletteCounts,
  sectionPaletteCounts,
} from '../src/index';

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

describe('sectionPaletteCounts', () => {
  const SECTIONS = [
    { id: 's1', name: 'Maths', order: 0, questionCount: 3, durationSec: null },
    { id: 's2', name: 'GK', order: 1, questionCount: 2, durationSec: null },
  ];
  const QUESTIONS = [
    { questionId: 'a', baseConfigSectionId: 's1' },
    { questionId: 'b', baseConfigSectionId: 's1' },
    { questionId: 'c', baseConfigSectionId: 's1' },
    { questionId: 'd', baseConfigSectionId: 's2' },
    { questionId: 'e', baseConfigSectionId: 's2' },
  ];

  it('counts each section against its own questions, not the whole paper', () => {
    const counts = sectionPaletteCounts(SECTIONS, QUESTIONS, {
      a: { state: ANSWER_STATE.ANSWERED },
      b: { state: ANSWER_STATE.MARKED_REVIEW },
      d: { state: ANSWER_STATE.ANSWERED },
    });

    assert.equal(counts.s1?.[ANSWER_STATE.ANSWERED], 1);
    assert.equal(counts.s1?.[ANSWER_STATE.MARKED_REVIEW], 1);
    assert.equal(counts.s1?.[ANSWER_STATE.NOT_VISITED], 1);
    assert.equal(counts.s2?.[ANSWER_STATE.ANSWERED], 1);
    assert.equal(counts.s2?.[ANSWER_STATE.NOT_VISITED], 1);
  });

  it('gives a section with nothing answered its full count as not visited', () => {
    const counts = sectionPaletteCounts(SECTIONS, QUESTIONS, {});

    assert.equal(counts.s1?.[ANSWER_STATE.NOT_VISITED], 3);
    assert.equal(counts.s2?.[ANSWER_STATE.NOT_VISITED], 2);
  });

  it('partitions the paper, so the sections sum to the whole', () => {
    const answers = {
      a: { state: ANSWER_STATE.ANSWERED },
      d: { state: ANSWER_STATE.ANSWERED_MARKED },
    };
    const whole = paletteCounts(
      QUESTIONS.map((row) => row.questionId),
      answers,
    );
    const split = sectionPaletteCounts(SECTIONS, QUESTIONS, answers);

    for (const state of ANSWER_STATES) {
      assert.equal(
        (split.s1?.[state] ?? 0) + (split.s2?.[state] ?? 0),
        whole[state],
        `${state} must not be double counted or lost`,
      );
    }
  });
});
