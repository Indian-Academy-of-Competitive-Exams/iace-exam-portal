import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANSWER_MODE,
  QUESTION_TYPE,
  QUESTION_VALIDATION_CODE as CODE,
  canonicalStemKey,
  emptyTaxonomy,
  firstMathFailure,
  languagesIn,
  validateQuestion,
  type QuestionDraft,
  type TaxonomyContext,
} from '../src/index';

const SUBJECT = 'sub_quant';
const TOPIC = 'top_percentages';

function taxonomy(): TaxonomyContext {
  return {
    subjects: new Map([[SUBJECT, { id: SUBJECT, name: 'Quantitative Aptitude' }]]),
    topics: new Map([[TOPIC, { id: TOPIC, name: 'Percentages', subjectId: SUBJECT }]]),
  };
}

const option = (position: number, text: string, isCorrect = false) => ({
  position,
  text: { en: `<p>${text}</p>` },
  isCorrect,
});

/** A question that passes every rule, so a case can break exactly one thing. */
const sound = (over: Partial<QuestionDraft> = {}): QuestionDraft =>
  ({
    type: QUESTION_TYPE.SINGLE_MCQ,
    subjectId: SUBJECT,
    topicId: TOPIC,
    difficulty: 'MEDIUM',
    stem: { en: '<p>What is 10% of 50?</p>' },
    options: [option(1, 'five', true), option(2, 'ten'), option(3, 'fifteen'), option(4, 'twenty')],
    tags: [],
    ...over,
  }) as QuestionDraft;

const codes = (draft: QuestionDraft) =>
  validateQuestion(draft, taxonomy()).map((issue) => issue.code);

describe('validateQuestion — a question nothing is wrong with', () => {
  it('reports nothing at all', () => {
    assert.deepEqual(validateQuestion(sound(), taxonomy()), []);
  });

  /** Reported, never thrown: one bad row in an import must not stop the good ones beside it. */
  it('returns every problem at once rather than the first', () => {
    const broken = sound({ stem: { en: '' }, options: [], subjectId: '' });

    assert.ok(codes(broken).length > 2, 'a draft this bad has more than one thing to say');
  });
});

describe('validateQuestion — the languages', () => {
  it('needs English however much else is there', () => {
    const hindiOnly = sound({ stem: { hi: '<p>५० का १०% क्या है?</p>' } });

    assert.ok(codes(hindiOnly).includes(CODE.ENGLISH_STEM_REQUIRED));
  });

  /** A half-translated paper is unusable in that language, and this is how it starts. */
  it('refuses a translated option with no question text in that language', () => {
    const half = sound({
      options: [
        { position: 1, text: { en: '<p>five</p>', hi: '<p>पाँच</p>' }, isCorrect: true },
        option(2, 'ten'),
        option(3, 'fifteen'),
        option(4, 'twenty'),
      ],
    });

    assert.ok(codes(half).includes(CODE.TRANSLATION_WITHOUT_STEM));
  });

  it('refuses a language this platform does not hold questions in', () => {
    const french = sound({ stem: { en: '<p>Ten?</p>', fr: '<p>Dix?</p>' } as never });

    assert.ok(codes(french).includes(CODE.UNSUPPORTED_LANGUAGE));
  });

  /** Markup is not content: the `<p></p>` an emptied editor posts is an unanswered field. */
  it('counts a language as authored only where there is text under the markup', () => {
    assert.deepEqual(languagesIn({ en: '<p>Ten?</p>', hi: '<p></p>' }), ['en']);
  });
});

describe('validateQuestion — the options of a multiple choice', () => {
  it('needs one marked correct', () => {
    const unmarked = sound({ options: [option(1, 'five'), option(2, 'ten')] });

    assert.ok(codes(unmarked).includes(CODE.CORRECT_OPTION_REQUIRED));
  });

  it('refuses two marked correct', () => {
    const both = sound({ options: [option(1, 'five', true), option(2, 'ten', true)] });

    assert.ok(codes(both).includes(CODE.CORRECT_OPTION_INVALID));
  });

  it('refuses two options that say the same thing', () => {
    const twice = sound({
      options: [option(1, 'five', true), option(2, 'Five!'), option(3, 'ten'), option(4, 'twenty')],
    });

    assert.ok(codes(twice).includes(CODE.OPTION_TEXT_DUPLICATE));
  });

  /** Seats, not names: a paper draws them in order, so 1, 2, 4 would move an option up a letter. */
  it('refuses a gap in the seats', () => {
    const gapped = sound({
      options: [option(1, 'five', true), option(2, 'ten'), option(4, 'twenty')],
    });

    assert.ok(codes(gapped).includes(CODE.OPTION_COUNT_INVALID));
  });

  it('refuses fewer options than a choice can be made from', () => {
    assert.ok(
      codes(sound({ options: [option(1, 'five', true)] })).includes(CODE.OPTION_COUNT_INVALID),
    );
  });

  it('refuses a typed answer on a question answered by picking one', () => {
    const both = sound({ answerKey: { mode: ANSWER_MODE.EXACT, answers: { en: '5' } } });

    assert.ok(codes(both).includes(CODE.ANSWER_NOT_ALLOWED));
  });
});

describe('validateQuestion — the answer of a typed question', () => {
  const typed = (over: Partial<QuestionDraft> = {}) =>
    sound({
      type: QUESTION_TYPE.TEXT_FIELD,
      options: [],
      answerKey: { mode: ANSWER_MODE.EXACT, answers: { en: 'five' } },
      ...over,
    });

  it('accepts one that carries its English answer', () => {
    assert.deepEqual(validateQuestion(typed(), taxonomy()), []);
  });

  it('needs that answer', () => {
    assert.ok(codes(typed({ answerKey: null })).includes(CODE.ANSWER_REQUIRED));
  });

  it('refuses options on a question nobody picks from', () => {
    assert.ok(
      codes(typed({ options: [option(1, 'five', true)] })).includes(CODE.OPTIONS_NOT_ALLOWED),
    );
  });

  /** Compared as a number, so a word there would never match whatever the student types. */
  it('refuses a numeric answer that is not a number', () => {
    const worded = typed({ answerKey: { mode: ANSWER_MODE.NUMERIC, answers: { en: 'five' } } });

    assert.ok(codes(worded).includes(CODE.ANSWER_NOT_NUMERIC));
  });

  it('takes a number written with spaces around it', () => {
    const spaced = typed({ answerKey: { mode: ANSWER_MODE.NUMERIC, answers: { en: ' 5.5 ' } } });

    assert.deepEqual(validateQuestion(spaced, taxonomy()), []);
  });

  it('refuses a tolerance on an answer compared as text', () => {
    const toleranced = typed({
      answerKey: { mode: ANSWER_MODE.EXACT, answers: { en: 'five' }, tolerance: 0.5 },
    });

    assert.ok(codes(toleranced).includes(CODE.TOLERANCE_NOT_ALLOWED));
  });
});

describe('validateQuestion — the taxonomy the ids must resolve against', () => {
  it('needs a subject', () => {
    assert.ok(codes(sound({ subjectId: '' })).includes(CODE.SUBJECT_REQUIRED));
  });

  it('refuses a subject the bank does not hold', () => {
    assert.ok(codes(sound({ subjectId: 'sub_gone' })).includes(CODE.SUBJECT_UNKNOWN));
  });

  it('refuses a topic the bank does not hold', () => {
    assert.ok(codes(sound({ topicId: 'top_gone' })).includes(CODE.TOPIC_UNKNOWN));
  });

  /** The check no foreign key can make: the question carries both ids, and they must agree. */
  it('refuses a topic that belongs to another subject', () => {
    const context = taxonomy();
    context.subjects.set('sub_reasoning', { id: 'sub_reasoning', name: 'Reasoning' });
    const crossed = sound({ subjectId: 'sub_reasoning' });

    const issues = validateQuestion(crossed, context).map((issue) => issue.code);
    assert.ok(issues.includes(CODE.TOPIC_NOT_IN_SUBJECT));
  });

  it('is happy with a question that names no topic at all', () => {
    assert.deepEqual(validateQuestion(sound({ topicId: null }), taxonomy()), []);
  });

  it('says the subject is unknown when there is no bank to check against', () => {
    assert.ok(
      validateQuestion(sound(), emptyTaxonomy())
        .map((issue) => issue.code)
        .includes(CODE.SUBJECT_UNKNOWN),
    );
  });
});

describe('validateQuestion — the formulas', () => {
  const refuseAll = () => 'Undefined control sequence';
  const mathIn = (draft: QuestionDraft) =>
    validateQuestion(draft, taxonomy(), refuseAll).map((issue) => issue.code);

  /** The screen can be bypassed: a draft posted straight at the API carries whatever LaTeX it likes. */
  it('refuses a formula the renderer will not draw', () => {
    const broken = sound({
      stem: { en: '<p>What is <span data-latex="\\\\frac{1}{"></span>?</p>' },
    });

    assert.ok(mathIn(broken).includes(CODE.MATH_INVALID));
  });

  it('says nothing about content holding no formula at all', () => {
    assert.deepEqual(mathIn(sound()), []);
  });

  it('stops at the first formula that fails, which is the one to fix', () => {
    const failure = firstMathFailure(
      '<span data-latex="\\\\frac{1}{"></span><span data-latex="\\\\sqrt{"></span>',
      refuseAll,
    );

    assert.equal(failure?.latex, '\\\\frac{1}{');
  });
});

describe('canonicalStemKey — what makes two questions the same question', () => {
  it('reads through case, spacing and punctuation', () => {
    const one = sound();
    const shouted = sound({ stem: { en: '<p>WHAT IS 10%  OF 50 ?!</p>' } });

    assert.equal(canonicalStemKey(one), canonicalStemKey(shouted));
  });

  /** A set, not a list: the same four options shuffled are the same question. */
  it('reads through the order the options were written in', () => {
    const one = sound();
    const shuffled = sound({
      options: [
        option(1, 'twenty'),
        option(2, 'ten'),
        option(3, 'fifteen'),
        option(4, 'five', true),
      ],
    });

    assert.equal(canonicalStemKey(one), canonicalStemKey(shuffled));
  });

  it('tells apart two questions whose options differ', () => {
    const other = sound({
      options: [
        option(1, 'five', true),
        option(2, 'ten'),
        option(3, 'fifteen'),
        option(4, 'thirty'),
      ],
    });

    assert.notEqual(canonicalStemKey(sound()), canonicalStemKey(other));
  });

  /** Same stem, same options, different key: which one is right is what the question IS. */
  it('tells apart two questions that disagree about the answer', () => {
    const moved = sound({
      options: [
        option(1, 'five'),
        option(2, 'ten', true),
        option(3, 'fifteen'),
        option(4, 'twenty'),
      ],
    });

    assert.notEqual(canonicalStemKey(sound()), canonicalStemKey(moved));
  });

  it('keys a typed question on its answer rather than on options it has none of', () => {
    const typed = sound({
      type: QUESTION_TYPE.TEXT_FIELD,
      options: [],
      answerKey: { mode: ANSWER_MODE.EXACT, answers: { en: 'five' } },
    });

    assert.equal(canonicalStemKey(typed).split('||')[1], '');
  });
});
