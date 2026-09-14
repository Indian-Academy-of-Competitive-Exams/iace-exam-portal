import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANSWER_STATE, DIFFICULTY_LEVEL } from '@iace/contracts';
import { timeUseOf, type AnalysedQuestion } from '../src/attempts/attempt-analytics';

function asked(overrides: Partial<AnalysedQuestion> = {}): AnalysedQuestion {
  return {
    baseConfigSectionId: 'sec_a',
    subjectId: 'sub_r',
    subjectName: 'Reasoning',
    difficulty: DIFFICULTY_LEVEL.MEDIUM,
    state: ANSWER_STATE.ANSWERED,
    answered: true,
    isCorrect: true,
    marksAwarded: 2,
    timeSpentSec: 30,
    ...overrides,
  };
}

const right = asked();
const wrong = asked({ isCorrect: false, marksAwarded: -0.5, timeSpentSec: 60 });
const untouched = asked({
  answered: false,
  isCorrect: null,
  marksAwarded: 0,
  timeSpentSec: 0,
  state: ANSWER_STATE.NOT_VISITED,
});

describe('timeUseOf', () => {
  it('separates the time that earned marks from the time that lost them', () => {
    const time = timeUseOf([right, wrong, asked({ ...untouched, timeSpentSec: 12 })]);

    assert.equal(time.totalSec, 102);
    assert.equal(time.avgOnCorrectSec, 30);
    assert.equal(time.avgOnWrongSec, 60);
    assert.equal(time.spentOnUnattemptedSec, 12);
    assert.equal(time.avgPerQuestionSec, 34);
  });

  it('reports zero rather than NaN where there is nothing of that kind to average', () => {
    const time = timeUseOf([right]);

    assert.equal(time.avgOnWrongSec, 0);
  });
});
