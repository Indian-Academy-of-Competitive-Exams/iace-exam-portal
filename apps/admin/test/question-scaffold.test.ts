import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANSWER_MODE,
  DIFFICULTY_LEVEL,
  MCQ_OPTION_MAX,
  TAGS_MAX,
  QUESTION_TYPE,
  questionDraftSchema,
  validateQuestion,
  type QuestionDraft,
} from '@iace/contracts';
import {
  REGION_KEYS,
  answerIndexOf,
  emptyState,
  optionKey,
  OPTION_COUNTS,
  optionLetter,
  tagsIn,
  regionsFor,
  stateFrom,
  taxonomyFor,
  toDraft,
  withOptionCount,
  type AuthoringHeader,
  type AuthoringState,
} from '../src/components/authoring/question-scaffold';

const HEADER: AuthoringHeader = {
  subjectId: 'sub_1',
  topicId: 'top_1',
  difficulty: DIFFICULTY_LEVEL.MEDIUM,
  tags: 'ssc, time and work',
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

describe('the tags line', () => {
  /** Typed once for the batch, so what the typist wrote has to survive being read back. */
  it('splits on commas and drops the blanks around them', () => {
    assert.deepEqual(tagsIn(' ssc , time and work ,, '), ['ssc', 'time and work']);
    assert.deepEqual(tagsIn(''), []);
  });

  it('stops at the cap rather than posting a draft the server refuses', () => {
    const many = Array.from({ length: TAGS_MAX + 3 }, (_, index) => `tag${index}`).join(',');
    assert.equal(tagsIn(many).length, TAGS_MAX);
  });
});

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
    assert.deepEqual(parsed.tags, ['ssc', 'time and work']);
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

describe('the option count in the header', () => {
  it('resizes every language at once, so a translation keeps its slots', () => {
    const grown = withOptionCount(typed(), 6);

    assert.equal(grown.optionCount, 6);
    assert.equal(grown.content.hi.options.length, 6);
    assert.equal(grown.content.en.options[0], '<p>25</p>');
  });

  it('drops the empty ones off the end', () => {
    const state = withOptionCount(emptyState(), 6);

    assert.equal(withOptionCount(state, 2).optionCount, 2);
  });

  /** The failure this prevents: a typed option lost to a dropdown, with no way back. */
  it('will not shrink past an option that says something', () => {
    const four = typed();

    assert.equal(withOptionCount(four, 2).optionCount, 4);
    assert.equal(withOptionCount(four, 4).content.en.options[3], '<p>40</p>');
  });

  it('stops at what a paper prints', () => {
    assert.deepEqual(OPTION_COUNTS, [2, 3, 4, 5, 6]);
    assert.equal(withOptionCount(emptyState(), 99).optionCount, MCQ_OPTION_MAX);
  });

  /** The count is the header's alone, so the letters follow it and nothing else. */
  it('letters the slots straight off the count', () => {
    const six = withOptionCount(emptyState(), 6);

    assert.deepEqual(
      regionsFor(six, 'en')
        .filter((region) => region.key.startsWith('option:'))
        .map((region) => region.label),
      ['A', 'B', 'C', 'D', 'E', 'F'],
    );
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
});
