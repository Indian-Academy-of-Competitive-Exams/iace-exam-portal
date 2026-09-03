import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANSWER_MODE,
  PAPER_QUESTION_STATUS,
  QUESTION_TYPE,
  type AnswerKey,
  type PaperQuestionStatus,
} from '@iace/contracts';
import { scorePaper, type ScorableQuestion } from '../src/attempts/score-paper';
import { rowAt } from './support/fakes';

const MARKS = 2;
const NEGATIVE = 0.5;

function mcq(overrides: Partial<ScorableQuestion> = {}): ScorableQuestion {
  return {
    questionId: 'q1',
    baseConfigSectionId: 'sec_a',
    type: QUESTION_TYPE.SINGLE_MCQ,
    marks: MARKS,
    negativeMarks: NEGATIVE,
    status: PAPER_QUESTION_STATUS.ACTIVE,
    correctOptionIds: ['o2'],
    answerKey: null,
    selectedOptionId: null,
    typedAnswer: null,
    timeSpentSec: 0,
    ...overrides,
  };
}

const only = (row: ScorableQuestion) => rowAt(scorePaper([row]).questions);

// --------------------------------------------------------------------------- the truth table
// ---------------------------------------------------------------------------

interface Case {
  what: string;
  status: PaperQuestionStatus;
  selectedOptionId: string | null;
  isCorrect: boolean | null;
  marksAwarded: number;
}

const TRUTH_TABLE: Case[] = [
  {
    what: 'right answer',
    status: PAPER_QUESTION_STATUS.ACTIVE,
    selectedOptionId: 'o2',
    isCorrect: true,
    marksAwarded: MARKS,
  },
  {
    what: 'wrong answer',
    status: PAPER_QUESTION_STATUS.ACTIVE,
    selectedOptionId: 'o3',
    isCorrect: false,
    marksAwarded: -NEGATIVE,
  },
  {
    what: 'left alone',
    status: PAPER_QUESTION_STATUS.ACTIVE,
    selectedOptionId: null,
    isCorrect: null,
    marksAwarded: 0,
  },
  {
    what: 'dropped, answered right',
    status: PAPER_QUESTION_STATUS.DROPPED,
    selectedOptionId: 'o2',
    isCorrect: true,
    marksAwarded: MARKS,
  },
  {
    what: 'dropped, answered wrong',
    status: PAPER_QUESTION_STATUS.DROPPED,
    selectedOptionId: 'o3',
    isCorrect: false,
    marksAwarded: MARKS,
  },
  {
    what: 'dropped, left alone',
    status: PAPER_QUESTION_STATUS.DROPPED,
    selectedOptionId: null,
    isCorrect: null,
    marksAwarded: 0,
  },
  {
    what: 'bonus, answered right',
    status: PAPER_QUESTION_STATUS.BONUS,
    selectedOptionId: 'o2',
    isCorrect: true,
    marksAwarded: MARKS,
  },
  {
    what: 'bonus, answered wrong',
    status: PAPER_QUESTION_STATUS.BONUS,
    selectedOptionId: 'o3',
    isCorrect: false,
    marksAwarded: MARKS,
  },
  {
    what: 'bonus, left alone',
    status: PAPER_QUESTION_STATUS.BONUS,
    selectedOptionId: null,
    isCorrect: null,
    marksAwarded: MARKS,
  },
];

describe('scorePaper — one question, every disposition', () => {
  for (const row of TRUTH_TABLE) {
    it(`${row.what} → ${row.isCorrect === null ? 'unjudged' : String(row.isCorrect)}, ${row.marksAwarded}`, () => {
      const scored = only(mcq({ status: row.status, selectedOptionId: row.selectedOptionId }));

      assert.equal(scored.isCorrect, row.isCorrect);
      assert.equal(scored.marksAwarded, row.marksAwarded);
    });
  }

  it('never lets a drop or a bonus rewrite what the answer key said', () => {
    const dropped = only(mcq({ status: PAPER_QUESTION_STATUS.DROPPED, selectedOptionId: 'o3' }));

    // The marks move; the verdict is a fact about the student, so it does not.
    assert.equal(dropped.marksAwarded, MARKS);
    assert.equal(dropped.isCorrect, false);
  });
});

// --------------------------------------------------------------------------- typed answers
// ---------------------------------------------------------------------------

const exactKey: AnswerKey = { mode: ANSWER_MODE.EXACT, answers: { en: 'Rani  Lakshmibai' } };
const numericKey: AnswerKey = {
  mode: ANSWER_MODE.NUMERIC,
  answers: { en: '3.1416' },
  tolerance: 0.01,
};

function typed(typedAnswer: string | null, answerKey: AnswerKey | null) {
  return only(mcq({ type: QUESTION_TYPE.TEXT_FIELD, typedAnswer, answerKey }));
}

describe('scorePaper — a typed answer', () => {
  it('accepts a different case and different spacing as the same answer', () => {
    assert.equal(typed('rani lakshmibai', exactKey).isCorrect, true);
  });

  it('refuses a different answer', () => {
    assert.equal(typed('Rani of Jhansi', exactKey).isCorrect, false);
    assert.equal(typed('Rani of Jhansi', exactKey).marksAwarded, -NEGATIVE);
  });

  it('treats an empty box as left alone, not as a wrong answer', () => {
    assert.equal(typed('   ', exactKey).isCorrect, null);
    assert.equal(typed('   ', exactKey).marksAwarded, 0);
  });

  it('allows the tolerance either side of a numeric answer, and no further', () => {
    assert.equal(typed('3.15', numericKey).isCorrect, true);
    assert.equal(typed('3.14', numericKey).isCorrect, true);
    assert.equal(typed('3.13', numericKey).isCorrect, false);
  });

  it('refuses anything that is not a number where a number was asked for', () => {
    assert.equal(typed('about three', numericKey).isCorrect, false);
  });

  it('leaves a question with no usable key unjudged rather than marking a cohort down', () => {
    assert.equal(typed('anything', null).isCorrect, null);
    assert.equal(typed('anything', null).marksAwarded, 0);
    assert.equal(typed('anything', { mode: ANSWER_MODE.EXACT, answers: {} }).isCorrect, null);
  });
});

// --------------------------------------------------------------------------- a whole paper
// ---------------------------------------------------------------------------

describe('scorePaper — the totals a score card reads', () => {
  it('counts right, wrong and untouched, and they sum to the paper', () => {
    const scored = scorePaper([
      mcq({ questionId: 'q1', selectedOptionId: 'o2' }),
      mcq({ questionId: 'q2', selectedOptionId: 'o2' }),
      mcq({ questionId: 'q3', selectedOptionId: 'o4' }),
      mcq({ questionId: 'q4', selectedOptionId: null }),
    ]);

    assert.equal(scored.correctCount, 2);
    assert.equal(scored.wrongCount, 1);
    assert.equal(scored.unattemptedCount, 1);
    assert.equal(
      scored.correctCount + scored.wrongCount + scored.unattemptedCount,
      scored.questions.length,
    );
    assert.equal(scored.score, 3.5);
  });

  it('keeps a paper of tenths exact, where adding floats would not', () => {
    const rows = Array.from({ length: 3 }, (_, index) =>
      mcq({ questionId: `q${index}`, negativeMarks: 0.1, selectedOptionId: 'o4' }),
    );

    assert.equal(scorePaper(rows).score, -0.3);
  });

  it('splits the paper by section, each with its own marks and its own clock', () => {
    const scored = scorePaper([
      mcq({ questionId: 'q1', selectedOptionId: 'o2', timeSpentSec: 30 }),
      mcq({ questionId: 'q2', selectedOptionId: 'o4', timeSpentSec: 15 }),
      mcq({
        questionId: 'q3',
        baseConfigSectionId: 'sec_b',
        marks: 1,
        negativeMarks: 0.25,
        selectedOptionId: 'o2',
        timeSpentSec: 40,
      }),
      mcq({ questionId: 'q4', baseConfigSectionId: 'sec_b', marks: 1, negativeMarks: 0.25 }),
    ]);

    assert.deepEqual(scored.sections, [
      {
        baseConfigSectionId: 'sec_a',
        score: 1.5,
        correctCount: 1,
        wrongCount: 1,
        unattemptedCount: 0,
        timeSpentSec: 45,
      },
      {
        baseConfigSectionId: 'sec_b',
        score: 1,
        correctCount: 1,
        wrongCount: 0,
        unattemptedCount: 1,
        timeSpentSec: 40,
      },
    ]);
    assert.equal(scored.score, 2.5);
  });

  it('leaves an option-less question unjudged, however confidently it was answered', () => {
    const scored = only(mcq({ correctOptionIds: [], selectedOptionId: 'o2' }));

    assert.equal(scored.isCorrect, null);
    assert.equal(scored.marksAwarded, 0);
  });

  it('scores an empty paper as nothing rather than as an error', () => {
    assert.deepEqual(scorePaper([]), {
      questions: [],
      score: 0,
      correctCount: 0,
      wrongCount: 0,
      unattemptedCount: 0,
      sections: [],
    });
  });
});
