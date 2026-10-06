import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANSWER_MODE,
  DIFFICULTY_LEVEL,
  QUESTION_TYPE,
  authoringDuplicateQuerySchema,
  canonicalStemKey,
  type QuestionDraft,
} from '../src/index';

/** A question a few seconds in: nothing chosen in the header, and a tag and a tolerance half typed. */
const unfinished = { subjectId: '', difficulty: DIFFICULTY_LEVEL.MEDIUM, tags: ['x'] };

const HALF_WRITTEN: Record<string, QuestionDraft> = {
  'a multiple choice question': {
    ...unfinished,
    type: QUESTION_TYPE.SINGLE_MCQ,
    stem: { en: '<p>What is 10% of 50?</p>' },
    options: [
      { position: 1, text: { en: '<p>5</p>' }, isCorrect: true },
      { position: 2, text: { en: '<p>10</p>' }, isCorrect: false },
    ],
  },
  'a typed answer question': {
    ...unfinished,
    type: QUESTION_TYPE.TEXT_FIELD,
    stem: { en: '<p>What is 10% of 50?</p>' },
    options: [],
    answerKey: { mode: ANSWER_MODE.NUMERIC, answers: { en: '5' }, tolerance: -1 },
  },
};

describe('the duplicate check', () => {
  for (const [name, draft] of Object.entries(HALF_WRITTEN)) {
    /** The failure this prevents: a typist told their details are not valid for writing a stem before choosing a subject. */
    it(`asks ${name} only for what its identity is read from`, () => {
      assert.equal(authoringDuplicateQuerySchema.safeParse(draft).success, true);
    });

    /** The failure this prevents: a field the key reads dropped on the way in, and no duplicate found again. */
    it(`keeps everything the identity of ${name} is read from`, () => {
      const asked = authoringDuplicateQuerySchema.parse(draft);

      assert.equal(canonicalStemKey(asked), canonicalStemKey(draft));
    });
  }
});
