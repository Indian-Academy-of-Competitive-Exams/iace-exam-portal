import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANSWER_STATE,
  QUESTION_TYPE,
  type ExamQuestion,
  type PaletteCounts,
} from '@iace/contracts';
import { answersByKeyboard } from '../src/exam-keyboard-answer';
import { paperRulesFor } from '../src/exam-paper-rules';
import { sectionTally } from '../src/exam-section-tally';

const terms = (traits: Parameters<typeof paperRulesFor>[0]) =>
  paperRulesFor(traits).map((rule) => rule.term);

describe('paperRulesFor', () => {
  it('teaches Save and Mark on a free CBT, Save alone when forward only', () => {
    const free = terms({ forwardOnly: false, sectional: false, omr: false });
    const forward = terms({ forwardOnly: true, sectional: false, omr: false });
    assert.ok(free.includes('Mark for review & next'));
    assert.ok(!forward.includes('Mark for review & next'));
  });

  it('swaps the buttons for the bubble on OMR and adds the section clock when sectional', () => {
    const omr = terms({ forwardOnly: false, sectional: true, omr: true });
    assert.ok(omr.includes('The bubble') && omr.includes('Sectional timing'));
    assert.ok(!omr.includes('Clear response'));
  });
});

describe('sectionTally', () => {
  it('names only the states that have questions', () => {
    const counts = {
      [ANSWER_STATE.NOT_VISITED]: 0,
      [ANSWER_STATE.NOT_ANSWERED]: 0,
      [ANSWER_STATE.ANSWERED]: 2,
      [ANSWER_STATE.MARKED_REVIEW]: 0,
      [ANSWER_STATE.ANSWERED_MARKED]: 0,
    } as PaletteCounts;
    assert.match(sectionTally(counts), /^2 /);
    assert.equal(sectionTally({ ...counts, [ANSWER_STATE.ANSWERED]: 0 }), '');
  });
});

describe('answersByKeyboard', () => {
  it('is true for typed and written questions only', () => {
    const of = (type: string) => ({ type }) as unknown as ExamQuestion;
    assert.equal(answersByKeyboard(of(QUESTION_TYPE.TYPING)), true);
    assert.equal(answersByKeyboard(of(QUESTION_TYPE.DESCRIPTIVE)), true);
    assert.equal(answersByKeyboard(of(QUESTION_TYPE.SINGLE_MCQ)), false);
    assert.equal(answersByKeyboard(undefined), false);
  });
});
