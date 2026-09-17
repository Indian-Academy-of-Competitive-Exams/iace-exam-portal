import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANSWER_MODE,
  ANSWER_STATE,
  LANGUAGE_CODE,
  LANGUAGE_MODE,
  PAPER_QUESTION_STATUS,
  QUESTION_TYPE,
} from '@iace/contracts';
import {
  reviewScreen,
  verdictOf,
  VERDICT,
  type ReviewedQuestion,
} from '../src/components/review/review-protocol';

const node = (text: string) => [{ type: 'TEXT' as const, text }];

const sat: ReviewedQuestion = {
  questionId: 'q1',
  order: 3,
  baseConfigSectionId: 's1',
  state: ANSWER_STATE.ANSWERED,
  selectedOptionId: 'o1',
  typedAnswer: null,
  isCorrect: false,
  marksAwarded: -0.5,
  marks: 2,
  negativeMarks: 0.5,
  disposition: PAPER_QUESTION_STATUS.ACTIVE,
  timeSpentSec: 40,
  type: QUESTION_TYPE.SINGLE_MCQ,
  content: {
    en: { stem: node('<p>Solve for x</p>'), solution: node('<p>x is 2</p>') },
  },
  options: [
    { id: 'o1', position: 0, isCorrect: false, text: { en: node('1') } },
    { id: 'o2', position: 1, isCorrect: true, text: { en: node('2') } },
  ],
  answerKey: null,
};

const screenOf = (question: ReviewedQuestion) =>
  reviewScreen({
    question,
    languages: [LANGUAGE_CODE.EN],
    languageMode: LANGUAGE_MODE.SINGLE,
  });

test('a reviewed question names the key, their own pick and the working', () => {
  const screen = screenOf(sat);

  assert.equal(screen.review?.correctOptionId, 'o2');
  assert.equal(screen.selectedOptionId, 'o1');
  assert.deepEqual(screen.review?.solution, [{ lang: 'en', html: '<p>x is 2</p>' }]);
});

test('a reviewed question can never be answered again', () => {
  const screen = screenOf(sat);

  assert.equal(screen.locked, true);
  assert.equal(screen.bubbling, false);
  assert.deepEqual(
    screen.options.map((option) => option.fill),
    [0, 0],
  );
});

test('a question nobody wrote a solution for draws no solution block', () => {
  const screen = screenOf({ ...sat, content: { en: { stem: node('<p>Solve for x</p>') } } });

  assert.deepEqual(screen.review?.solution, []);
});

test('a typed answer is shown against the key it was compared with', () => {
  const screen = screenOf({
    ...sat,
    type: QUESTION_TYPE.TEXT_FIELD,
    selectedOptionId: null,
    typedAnswer: '42',
    options: [],
    answerKey: { mode: ANSWER_MODE.EXACT, answers: { en: '42' } },
  });

  assert.equal(screen.review?.typedAnswer, '42');
  assert.equal(screen.review?.answerKey, '42');
  assert.equal(screen.review?.correctOptionId, null);
});

test('the gate still shut leaves their own answer standing, with nothing to mark it against', () => {
  const { content: _content, options: _options, answerKey: _key, ...ownAnswerOnly } = sat;
  const screen = screenOf(ownAnswerOnly);

  assert.deepEqual(screen.options, []);
  assert.equal(screen.review?.correctOptionId, null);
  assert.equal(screen.selectedOptionId, 'o1');
});

test('a verdict reads off the marking, never off what they picked', () => {
  assert.equal(verdictOf(sat), VERDICT.WRONG);
  assert.equal(verdictOf({ ...sat, isCorrect: true }), VERDICT.RIGHT);
  assert.equal(verdictOf({ ...sat, isCorrect: null, selectedOptionId: null }), VERDICT.LEFT);
});
