import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANSWER_MODE,
  DIFFICULTY_LEVEL,
  MCQ_OPTION_MAX,
  QUESTION_TYPE,
  questionDraftSchema,
  validateQuestion,
  type QuestionDraft,
} from '@iace/contracts';
import {
  OPTION_REPEAT,
  REGION_KEYS,
  answerIndexOf,
  emptyState,
  optionKey,
  optionLetter,
  regionsFor,
  stateFrom,
  taxonomyFor,
  toDraft,
  type AuthoringHeader,
  type AuthoringState,
} from '../src/components/authoring/question-scaffold';

const HEADER: AuthoringHeader = {
  subjectId: 'sub_1',
  topicId: 'top_1',
  difficulty: DIFFICULTY_LEVEL.MEDIUM,
  tags: ['ssc'],
};

/** A question as the box would hold it after a typist filled the English slots. */
function typed(over: Partial<AuthoringState> = {}): AuthoringState {
  const state = emptyState();
  return {
    ...state,
    answer: '<p>b</p>',
    content: {
      ...state.content,
      en: {
        stem: '<p>What is 20% of 150?</p>',
        options: ['<p>25</p>', '<p>30</p>', '<p>35</p>', '<p>40</p>'],
        solution: '<p>A fifth of 150 is 30.</p>',
      },
    },
    ...over,
  };
}

describe('the answer line', () => {
  it('takes a letter or a number and means the same option either way', () => {
    assert.equal(answerIndexOf('<p>b</p>', 4), 1);
    assert.equal(answerIndexOf('<p>2</p>', 4), 1);
    assert.equal(answerIndexOf('<p>B</p>', 4), 1);
    assert.equal(answerIndexOf('<p>(B)</p>', 4), 1);
  });

  it('names no option when it names one that is not there', () => {
    assert.equal(answerIndexOf('<p>e</p>', 4), null);
    assert.equal(answerIndexOf('<p>5</p>', 4), null);
    assert.equal(answerIndexOf('<p>thirty</p>', 4), null);
    assert.equal(answerIndexOf('', 4), null);
  });

  it('marks the option the letter names, and only that one', () => {
    const draft = toDraft(typed(), HEADER);

    assert.deepEqual(
      draft.options.map((option) => option.isCorrect),
      [false, true, false, false],
    );
  });
});

describe('the draft the box builds', () => {
  it('is the shape the importer targets, and the shared rules accept it', () => {
    const draft = toDraft(typed(), HEADER);
    const parsed = questionDraftSchema.parse(draft);

    assert.deepEqual(validateQuestion(parsed, taxonomyFor(HEADER)), []);
    assert.equal(parsed.stem.en, '<p>What is 20% of 150?</p>');
    assert.equal(parsed.options.length, 4);
    assert.deepEqual(parsed.tags, ['ssc']);
  });

  it('carries only the languages that say something', () => {
    const draft = toDraft(typed(), HEADER);

    assert.deepEqual(Object.keys(draft.stem), ['en']);
    assert.equal(draft.options[0]?.text.hi, undefined);
  });

  it('gives a typed answer an answer key and no options', () => {
    const base = emptyState(QUESTION_TYPE.TEXT_FIELD);
    const state: AuthoringState = {
      ...base,
      answer: '<p>42</p>',
      content: {
        ...base.content,
        en: { stem: '<p>What is six times seven?</p>', options: [], solution: '' },
      },
    };

    const parsed = questionDraftSchema.parse(toDraft(state, HEADER));

    assert.deepEqual(parsed.options, []);
    assert.equal(parsed.answerKey?.mode, ANSWER_MODE.NUMERIC);
    assert.equal(parsed.answerKey?.answers.en, '42');
    assert.deepEqual(validateQuestion(parsed, taxonomyFor(HEADER)), []);
  });

  it('refuses a question with no English text, the way the sheet is refused', () => {
    const parsed: QuestionDraft = questionDraftSchema.parse(toDraft(emptyState(), HEADER));
    const codes = validateQuestion(parsed, taxonomyFor(HEADER)).map((issue) => issue.code);

    assert.ok(codes.includes('ENGLISH_STEM_REQUIRED'));
  });
});

describe('the language toggle', () => {
  it('swaps the content and leaves the structure and the answer where they were', () => {
    const english = typed();
    const hindi = stateFrom(english, 'hi', [
      { key: REGION_KEYS.STEM, label: '', html: '<p>150 का 20% कितना है?</p>' },
      { key: optionKey(0), label: 'A', html: '<p>२५</p>' },
      { key: optionKey(1), label: 'B', html: '<p>३०</p>' },
      { key: optionKey(2), label: 'C', html: '<p>३५</p>' },
      { key: optionKey(3), label: 'D', html: '<p>४०</p>' },
      { key: REGION_KEYS.ANSWER, label: 'Answer', html: '<p>b</p>' },
      { key: REGION_KEYS.SOLUTION, label: 'Explanation', html: '' },
    ]);

    assert.equal(hindi.optionCount, 4);
    assert.equal(hindi.answer, '<p>b</p>');
    assert.equal(hindi.content.en.stem, english.content.en.stem);
    assert.equal(hindi.content.hi.stem, '<p>150 का 20% कितना है?</p>');

    const draft = toDraft(hindi, HEADER);
    assert.deepEqual(Object.keys(draft.stem), ['en', 'hi']);
    assert.deepEqual(
      draft.options.map((option) => option.isCorrect),
      [false, true, false, false],
    );
  });

  it('shows the same slots in every language', () => {
    const state = typed();

    assert.deepEqual(
      regionsFor(state, 'te').map((region) => region.key),
      regionsFor(state, 'en').map((region) => region.key),
    );
    assert.equal(regionsFor(state, 'te')[1]?.html, '');
  });
});

describe('the option run', () => {
  it('grows every language when the box grows, so a translation keeps its slot', () => {
    const grown = stateFrom(typed(), 'en', [
      { key: REGION_KEYS.STEM, label: '', html: '<p>Stem</p>' },
      ...Array.from({ length: 5 }, (_, index) => ({
        key: optionKey(index),
        label: optionLetter(index),
        html: `<p>${index}</p>`,
      })),
      { key: REGION_KEYS.ANSWER, label: 'Answer', html: '<p>e</p>' },
      { key: REGION_KEYS.SOLUTION, label: 'Explanation', html: '' },
    ]);

    assert.equal(grown.optionCount, 5);
    assert.equal(grown.content.hi.options.length, 5);
    assert.equal(answerIndexOf(grown.answer, grown.optionCount), 4);
    assert.equal(questionDraftSchema.parse(toDraft(grown, HEADER)).options[4]?.isCorrect, true);
  });

  it('stops where a paper stops, and is lettered the way a paper letters it', () => {
    assert.equal(OPTION_REPEAT.max, MCQ_OPTION_MAX);
    assert.equal(optionLetter(0), 'A');
    assert.equal(optionLetter(MCQ_OPTION_MAX - 1), 'F');
  });
});
