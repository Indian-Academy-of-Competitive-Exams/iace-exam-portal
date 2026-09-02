import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANSWER_MODE,
  DIFFICULTY_LEVEL,
  QUESTION_STATUS,
  QUESTION_TYPE,
  QUESTION_VALIDATION_CODE,
  plainTextOf,
  type QuestionDraft,
} from '@iace/contracts';
import {
  buildContent,
  computeStemHash,
  emptyTaxonomy,
  languagesIn,
  validateQuestion,
  type TaxonomyContext,
} from '../src/questions/question-core';

const SUBJECT = 'sub_quant';
const TOPIC = 'top_arithmetic';
const OTHER_SUBJECT = 'sub_reasoning';
const OTHER_SUBJECT_TOPIC = 'top_series';

/** Quant -> Arithmetic, and a second subject holding a topic of its own. */
function taxonomy(): TaxonomyContext {
  const context = emptyTaxonomy();
  context.subjects.set(SUBJECT, { id: SUBJECT, name: 'QUANTITATIVE APTITUDE' });
  context.subjects.set(OTHER_SUBJECT, { id: OTHER_SUBJECT, name: 'REASONING' });
  context.topics.set(TOPIC, { id: TOPIC, name: 'ARITHMETIC', subjectId: SUBJECT });
  context.topics.set(OTHER_SUBJECT_TOPIC, {
    id: OTHER_SUBJECT_TOPIC,
    name: 'SERIES',
    subjectId: OTHER_SUBJECT,
  });
  return context;
}

function mcq(over: Partial<QuestionDraft> = {}): QuestionDraft {
  return {
    type: QUESTION_TYPE.SINGLE_MCQ,
    subjectId: SUBJECT,
    topicId: TOPIC,
    difficulty: DIFFICULTY_LEVEL.MEDIUM,
    status: QUESTION_STATUS.ACTIVE,
    questionCode: null,
    stem: { en: 'What is 20% of 150?' },
    solution: {},
    options: [
      { position: 1, isCorrect: false, text: { en: '25' } },
      { position: 2, isCorrect: true, text: { en: '30' } },
      { position: 3, isCorrect: false, text: { en: '35' } },
      { position: 4, isCorrect: false, text: { en: '40' } },
    ],
    answerKey: null,
    tags: [],
    ...over,
  };
}

function typed(over: Partial<QuestionDraft> = {}): QuestionDraft {
  return mcq({
    type: QUESTION_TYPE.TEXT_FIELD,
    options: [],
    answerKey: { mode: ANSWER_MODE.EXACT, answers: { en: 'Delhi' } },
    stem: { en: 'Name the capital of India.' },
    ...over,
  });
}

const codes = (draft: QuestionDraft) =>
  validateQuestion(draft, taxonomy()).map((issue) => issue.code);

describe('validateQuestion — languages', () => {
  it('accepts a question with only English', () => {
    assert.deepEqual(codes(mcq()), []);
  });

  it('accepts a fully translated question', () => {
    const draft = mcq({
      stem: { en: 'What is 20% of 150?', hi: '150 का 20% कितना है?', te: '150లో 20% ఎంత?' },
      options: [
        { position: 1, isCorrect: false, text: { en: '25', hi: '25', te: '25' } },
        { position: 2, isCorrect: true, text: { en: '30', hi: '30', te: '30' } },
        { position: 3, isCorrect: false, text: { en: '35', hi: '35', te: '35' } },
        { position: 4, isCorrect: false, text: { en: '40', hi: '40', te: '40' } },
      ],
    });
    assert.deepEqual(codes(draft), []);
  });

  it('refuses a question with no English question text — the failure the bank exists to prevent', () => {
    assert.ok(
      codes(mcq({ stem: { hi: '150 का 20% कितना है?' } })).includes(
        QUESTION_VALIDATION_CODE.ENGLISH_STEM_REQUIRED,
      ),
    );
  });

  it('refuses a language key outside the supported set', () => {
    const draft = mcq({ stem: { en: 'Anything?', ta: 'ஏதேனும்?' } as QuestionDraft['stem'] });
    assert.ok(codes(draft).includes(QUESTION_VALIDATION_CODE.UNSUPPORTED_LANGUAGE));
  });

  it('refuses a translated option with no translated question text', () => {
    // A half-translated paper cannot be sat in that language.
    const draft = mcq({
      options: [
        { position: 1, isCorrect: false, text: { en: '25' } },
        { position: 2, isCorrect: true, text: { en: '30', hi: '30' } },
        { position: 3, isCorrect: false, text: { en: '35' } },
        { position: 4, isCorrect: false, text: { en: '40' } },
      ],
    });
    assert.ok(codes(draft).includes(QUESTION_VALIDATION_CODE.TRANSLATION_WITHOUT_STEM));
  });

  it('requires every option in a language the question IS written in', () => {
    const draft = mcq({
      stem: { en: 'What is 20% of 150?', hi: '150 का 20% कितना है?' },
      options: [
        { position: 1, isCorrect: false, text: { en: '25', hi: '25' } },
        { position: 2, isCorrect: true, text: { en: '30' } },
        { position: 3, isCorrect: false, text: { en: '35', hi: '35' } },
        { position: 4, isCorrect: false, text: { en: '40', hi: '40' } },
      ],
    });
    assert.ok(codes(draft).includes(QUESTION_VALIDATION_CODE.OPTION_TEXT_REQUIRED));
  });
});

describe('validateQuestion — multiple choice', () => {
  it('needs at least two, and takes the six an SBI PO paper prints', () => {
    const one = mcq({ options: mcq().options.slice(0, 1) });
    assert.ok(codes(one).includes(QUESTION_VALIDATION_CODE.OPTION_COUNT_INVALID));

    const three = mcq({ options: mcq().options.slice(0, 3) });
    assert.ok(!codes(three).includes(QUESTION_VALIDATION_CODE.OPTION_COUNT_INVALID));
  });

  /** A paper draws options in order, so a gap in the seats moves every one after it up a letter. */
  it('refuses options that skip a slot', () => {
    const gapped = mcq({
      options: mcq()
        .options.filter((option) => option.position !== 3)
        .map((option) => ({ ...option })),
    });
    assert.ok(codes(gapped).includes(QUESTION_VALIDATION_CODE.OPTION_COUNT_INVALID));
  });

  it('needs exactly one correct option', () => {
    const none = mcq({
      options: mcq().options.map((option) => ({ ...option, isCorrect: false })),
    });
    assert.ok(codes(none).includes(QUESTION_VALIDATION_CODE.CORRECT_OPTION_REQUIRED));

    const two = mcq({
      options: mcq().options.map((option) => ({ ...option, isCorrect: option.position <= 2 })),
    });
    assert.ok(two.options.filter((option) => option.isCorrect).length === 2);
    assert.ok(codes(two).includes(QUESTION_VALIDATION_CODE.CORRECT_OPTION_INVALID));
  });

  it('refuses two options that say the same thing', () => {
    const draft = mcq({
      options: [
        { position: 1, isCorrect: false, text: { en: '30' } },
        { position: 2, isCorrect: true, text: { en: '30' } },
        { position: 3, isCorrect: false, text: { en: '35' } },
        { position: 4, isCorrect: false, text: { en: '40' } },
      ],
    });
    assert.ok(codes(draft).includes(QUESTION_VALIDATION_CODE.OPTION_TEXT_DUPLICATE));
  });

  it('refuses a typed answer on a multiple-choice question', () => {
    const draft = mcq({ answerKey: { mode: ANSWER_MODE.EXACT, answers: { en: '30' } } });
    assert.ok(codes(draft).includes(QUESTION_VALIDATION_CODE.ANSWER_NOT_ALLOWED));
  });
});

describe('validateQuestion — typed answers', () => {
  it('accepts an exact answer', () => {
    assert.deepEqual(codes(typed()), []);
  });

  it('needs an English answer', () => {
    const draft = typed({ answerKey: { mode: ANSWER_MODE.EXACT, answers: { hi: 'दिल्ली' } } });
    assert.ok(codes(draft).includes(QUESTION_VALIDATION_CODE.ANSWER_REQUIRED));
  });

  it('refuses options on a typed-answer question', () => {
    const draft = typed({ options: mcq().options });
    assert.ok(codes(draft).includes(QUESTION_VALIDATION_CODE.OPTIONS_NOT_ALLOWED));
  });

  it('refuses a numeric answer that is not a number', () => {
    const draft = typed({
      answerKey: { mode: ANSWER_MODE.NUMERIC, answers: { en: 'about three' } },
    });
    assert.ok(codes(draft).includes(QUESTION_VALIDATION_CODE.ANSWER_NOT_NUMERIC));
  });

  it('accepts a numeric answer with a tolerance', () => {
    const draft = typed({
      answerKey: { mode: ANSWER_MODE.NUMERIC, answers: { en: '3.14' }, tolerance: 0.01 },
    });
    assert.deepEqual(codes(draft), []);
  });

  it('refuses a tolerance on a text comparison, where it means nothing', () => {
    const draft = typed({
      answerKey: { mode: ANSWER_MODE.EXACT, answers: { en: 'Delhi' }, tolerance: 0.5 },
    });
    assert.ok(codes(draft).includes(QUESTION_VALIDATION_CODE.TOLERANCE_NOT_ALLOWED));
  });
});

describe('validateQuestion — taxonomy', () => {
  it('refuses a subject that is not in the bank', () => {
    assert.ok(codes(mcq({ subjectId: 'nope' })).includes(QUESTION_VALIDATION_CODE.SUBJECT_UNKNOWN));
  });

  it('refuses a topic that is not under the subject — the check no foreign key can make', () => {
    // Both ids are columns on the question, so nothing stops SERIES being filed under
    // QUANTITATIVE APTITUDE except this rule.
    const draft = mcq({ topicId: OTHER_SUBJECT_TOPIC });
    assert.ok(codes(draft).includes(QUESTION_VALIDATION_CODE.TOPIC_NOT_IN_SUBJECT));
  });

  it('refuses a topic that is not in the bank', () => {
    assert.ok(codes(mcq({ topicId: 'nope' })).includes(QUESTION_VALIDATION_CODE.TOPIC_UNKNOWN));
  });

  it('accepts a question filed at subject level only', () => {
    assert.deepEqual(codes(mcq({ topicId: null })), []);
  });
});

describe('buildContent', () => {
  it('writes one text node per field, per authored language', () => {
    const built = buildContent(
      mcq({
        stem: { en: '  What is 20% of 150? ', hi: '150 का 20% कितना है?' },
        solution: { en: '150 × 0.2 = 30.' },
      }),
    );

    assert.deepEqual(Object.keys(built.content), ['en', 'hi']);
    assert.equal(plainTextOf(built.content.en?.stem), '<div>What is 20% of 150?</div>');
    assert.equal(plainTextOf(built.content.en?.solution), '<div>150 × 0.2 = 30.</div>');
    assert.equal(built.content.hi?.solution, undefined);
    assert.deepEqual(built.languages, ['en', 'hi']);
  });

  it('drops a language that has no question text of its own', () => {
    const built = buildContent(mcq({ solution: { te: 'ఇది ఒక వివరణ' } }));
    assert.deepEqual(Object.keys(built.content), ['en']);
  });

  it('keeps an option in every language the question has, and no others', () => {
    const built = buildContent(
      mcq({
        stem: { en: 'What is 20% of 150?', hi: '150 का 20% कितना है?' },
        options: [
          { position: 1, isCorrect: false, text: { en: '25', hi: '25', te: '25' } },
          { position: 2, isCorrect: true, text: { en: '30', hi: '30' } },
          { position: 3, isCorrect: false, text: { en: '35', hi: '35' } },
          { position: 4, isCorrect: false, text: { en: '40', hi: '40' } },
        ],
      }),
    );

    assert.deepEqual(Object.keys(built.options[0]!.text), ['en', 'hi']);
    assert.equal(built.options[1]!.isCorrect, true);
  });

  it('keeps a tolerance only where it is compared as a number', () => {
    const exact = buildContent(
      typed({ answerKey: { mode: ANSWER_MODE.EXACT, answers: { en: 'Delhi' }, tolerance: 1 } }),
    );
    assert.equal(exact.answerKey?.tolerance, undefined);

    const numeric = buildContent(
      typed({ answerKey: { mode: ANSWER_MODE.NUMERIC, answers: { en: '3.14' }, tolerance: 0.01 } }),
    );
    assert.equal(numeric.answerKey?.tolerance, 0.01);
  });
});

describe('validateQuestion — empty markup', () => {
  /** The bug: an emptied editor box posts `<p></p>`, and a question with no text was accepted. */
  it('refuses a stem that is markup with nothing in it', () => {
    assert.deepEqual(codes(mcq({ stem: { en: '<div><p></p></div>' } })), [
      QUESTION_VALIDATION_CODE.ENGLISH_STEM_REQUIRED,
      QUESTION_VALIDATION_CODE.TRANSLATION_WITHOUT_STEM,
    ]);
  });

  it('refuses an option that is markup with nothing in it', () => {
    const emptied = mcq({
      options: mcq().options.map((option) =>
        option.position === 3 ? { ...option, text: { en: '<p><br></p>' } } : option,
      ),
    });

    assert.deepEqual(codes(emptied), [QUESTION_VALIDATION_CODE.OPTION_TEXT_REQUIRED]);
  });

  /** A figure is the whole question in a reasoning paper — markup with no words is still content. */
  it('accepts a stem that is only a figure', () => {
    const figure = mcq({ stem: { en: '<div><img data-key="questions/images/a.png"></div>' } });

    assert.deepEqual(codes(figure), []);
  });

  it('leaves a language out that was opened and never filled in', () => {
    assert.deepEqual(languagesIn({ en: '<p>Two</p>', hi: '<p></p>' }), ['en']);
  });
});

describe('languagesIn', () => {
  it('counts a language only when it has a stem, and keeps the authoring order', () => {
    assert.deepEqual(languagesIn({ te: 'ఏమిటి?', en: 'What?' }), ['en', 'te']);
    assert.deepEqual(languagesIn({ en: '   ' }), []);
  });
});

describe('computeStemHash', () => {
  /** The rule the backfill rests on: rehashing a stored question must not move it. */
  it('is the same question typed into the form as imported from a sheet', () => {
    const sheet = computeStemHash(mcq());
    const form = computeStemHash(
      mcq({
        stem: { en: '<div><p>What is <strong>20%</strong> of 150?</p></div>' },
        options: [
          { position: 1, isCorrect: false, text: { en: '<div><p>25</p></div>' } },
          { position: 2, isCorrect: true, text: { en: '<div><p>30</p></div>' } },
          { position: 3, isCorrect: false, text: { en: '<div><p>35</p></div>' } },
          { position: 4, isCorrect: false, text: { en: '<div><p>40</p></div>' } },
        ],
      }),
    );

    assert.equal(form, sheet);
  });

  /** A reasoning paper's four options are four figures and not one word, but they differ. */
  it('separates two questions whose options are different figures', () => {
    const figures = (keys: string[]) =>
      mcq({
        options: keys.map((key, index) => ({
          position: index + 1,
          isCorrect: index === 1,
          text: { en: `<div><img data-key="questions/images/${key}.png"></div>` },
        })),
      });

    assert.notEqual(
      computeStemHash(figures(['a', 'b', 'c', 'd'])),
      computeStemHash(figures(['a', 'b', 'c', 'e'])),
    );
  });

  it('ignores case, spacing and punctuation', () => {
    const a = computeStemHash(mcq());
    const b = computeStemHash(mcq({ stem: { en: '  what is 20% of 150 ' } }));
    assert.equal(a, b);
  });

  it('ignores the ORDER of the options — a shuffled paper is not a second question', () => {
    const shuffled = mcq({
      options: [
        { position: 1, isCorrect: true, text: { en: '30' } },
        { position: 2, isCorrect: false, text: { en: '40' } },
        { position: 3, isCorrect: false, text: { en: '25' } },
        { position: 4, isCorrect: false, text: { en: '35' } },
      ],
    });
    assert.equal(computeStemHash(shuffled), computeStemHash(mcq()));
  });

  it('separates two questions that differ only in which option is right', () => {
    const other = mcq({
      options: mcq().options.map((option) => ({ ...option, isCorrect: option.position === 3 })),
    });
    assert.notEqual(computeStemHash(other), computeStemHash(mcq()));
  });

  it('separates two questions with the same stem and different options', () => {
    const other = mcq({
      options: [
        { position: 1, isCorrect: false, text: { en: '20' } },
        { position: 2, isCorrect: true, text: { en: '30' } },
        { position: 3, isCorrect: false, text: { en: '45' } },
        { position: 4, isCorrect: false, text: { en: '50' } },
      ],
    });
    assert.notEqual(computeStemHash(other), computeStemHash(mcq()));
  });

  it('does not fold a translated stem away to nothing', () => {
    // Stripping non-ASCII would hash every Hindi question to the same value.
    const hindi = computeStemHash(mcq({ stem: { en: '150 का 20% कितना है?' } }));
    const telugu = computeStemHash(mcq({ stem: { en: '150లో 20% ఎంత?' } }));
    assert.notEqual(hindi, telugu);
  });

  it('ignores option order even where UTF-16 and locale order disagree', () => {
    // 'café' sorts after 'zebra' by raw UTF-16 code unit, but before it under a
    // locale-aware compare — a plain .sort() would hash these two as different questions.
    const first = mcq({
      options: [
        { position: 1, isCorrect: false, text: { en: 'apple' } },
        { position: 2, isCorrect: true, text: { en: 'zebra' } },
        { position: 3, isCorrect: false, text: { en: 'café' } },
        { position: 4, isCorrect: false, text: { en: 'mango' } },
      ],
    });
    const shuffled = mcq({
      options: [
        { position: 1, isCorrect: false, text: { en: 'café' } },
        { position: 2, isCorrect: false, text: { en: 'mango' } },
        { position: 3, isCorrect: true, text: { en: 'zebra' } },
        { position: 4, isCorrect: false, text: { en: 'apple' } },
      ],
    });
    assert.equal(computeStemHash(first), computeStemHash(shuffled));
  });

  it('hashes a typed answer by its answer, not by options it does not have', () => {
    assert.notEqual(
      computeStemHash(typed()),
      computeStemHash(typed({ answerKey: { mode: ANSWER_MODE.EXACT, answers: { en: 'Mumbai' } } })),
    );
  });
});
