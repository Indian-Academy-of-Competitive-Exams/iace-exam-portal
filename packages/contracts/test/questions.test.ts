import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DIFFICULTY_LEVEL,
  LANGUAGE_ORDER,
  MCQ_OPTION_COUNT,
  QUESTION_IMPORT_COLUMNS,
  QUESTION_TYPE,
  SUPPORTED_LANGUAGES,
  localizedTextSchema,
  questionDraftSchema,
  questionListQuerySchema,
  subTopicNameSchema,
  tagSchema,
  questionCodeSchema,
} from '../src/index';

const draft = (over: Record<string, unknown> = {}) => ({
  subjectId: 'sub_1',
  difficulty: DIFFICULTY_LEVEL.MEDIUM,
  stem: { en: 'What is 2 + 2?' },
  options: [
    { position: 1, isCorrect: false, text: { en: '3' } },
    { position: 2, isCorrect: true, text: { en: '4' } },
    { position: 3, isCorrect: false, text: { en: '5' } },
    { position: 4, isCorrect: false, text: { en: '6' } },
  ],
  ...over,
});

describe('supported languages', () => {
  it('is exactly English, Hindi and Telugu', () => {
    assert.deepEqual(Object.values(SUPPORTED_LANGUAGES), ['en', 'hi', 'te']);
    assert.deepEqual([...LANGUAGE_ORDER], ['en', 'hi', 'te']);
  });

  it('refuses a content key outside the supported set', () => {
    // The whole point of the constant: a fourth language cannot be smuggled in
    // as a JSON key, where nothing downstream would ever render it.
    assert.equal(localizedTextSchema.safeParse({ en: 'a', hi: 'b', te: 'c' }).success, true);
    assert.equal(localizedTextSchema.safeParse({ en: 'a', ta: 'b' }).success, false);
    assert.equal(localizedTextSchema.safeParse({ EN: 'a' }).success, false);
  });

  it('treats every language as optional at the schema level', () => {
    // English is required by validateQuestion, which can say WHICH field is missing.
    assert.equal(localizedTextSchema.safeParse({}).success, true);
  });
});

describe('questionDraftSchema', () => {
  it('defaults type, status, options and tags so a bare draft parses', () => {
    const parsed = questionDraftSchema.parse(draft());
    assert.equal(parsed.type, QUESTION_TYPE.SINGLE_MCQ);
    assert.equal(parsed.status, 'ACTIVE');
    assert.deepEqual(parsed.tags, []);
  });

  it('accepts a multilingual draft', () => {
    const parsed = questionDraftSchema.parse(
      draft({
        stem: { en: 'What is 2 + 2?', hi: '2 + 2 कितना होता है?', te: '2 + 2 ఎంత?' },
        solution: { en: 'Add them.', te: 'కూడండి.' },
      }),
    );
    assert.deepEqual(Object.keys(parsed.stem), ['en', 'hi', 'te']);
    assert.equal(parsed.solution?.te, 'కూడండి.');
  });

  it('refuses more options than a CBT paper prints', () => {
    const tooMany = draft({
      options: Array.from({ length: MCQ_OPTION_COUNT + 1 }, (_, i) => ({
        position: i + 1,
        isCorrect: i === 0,
        text: { en: String(i) },
      })),
    });
    assert.equal(questionDraftSchema.safeParse(tooMany).success, false);
  });

  it('rejects marks with more precision than the column holds', () => {
    assert.equal(questionDraftSchema.safeParse(draft({ defaultMarks: 2.5 })).success, true);
    assert.equal(questionDraftSchema.safeParse(draft({ defaultMarks: 2.555 })).success, false);
  });
});

describe('names, tags and codes are normalised rather than refused', () => {
  it('canonicalises a sub-topic name', () => {
    assert.equal(subTopicNameSchema.parse('  percentages   basics '), 'PERCENTAGES BASICS');
  });

  it('folds a tag to one casing so a filter is one facet', () => {
    assert.equal(tagSchema.parse('  SSC   CGL '), 'ssc cgl');
  });

  it('uppercases a question code', () => {
    assert.equal(questionCodeSchema.parse(' ssc/cgl-2024.1 '), 'SSC/CGL-2024.1');
  });
});

describe('the import column contract', () => {
  it('has unique keys and unique normalised headers', () => {
    const keys = QUESTION_IMPORT_COLUMNS.map((c) => c.key);
    assert.equal(new Set(keys).size, keys.length);

    const normalise = (v: string) =>
      v
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '');
    const headers = QUESTION_IMPORT_COLUMNS.map((c) => normalise(c.header));
    assert.equal(new Set(headers).size, headers.length);
  });

  it('carries every language column the supported set implies', () => {
    for (const language of LANGUAGE_ORDER) {
      for (const field of ['stem', 'solution', 'answer']) {
        assert.ok(
          QUESTION_IMPORT_COLUMNS.some((c) => c.key === `${field}_${language}`),
          `missing ${field}_${language}`,
        );
      }
      for (let i = 1; i <= MCQ_OPTION_COUNT; i += 1) {
        assert.ok(
          QUESTION_IMPORT_COLUMNS.some((c) => c.key === `option${i}_${language}`),
          `missing option${i}_${language}`,
        );
      }
    }
  });

  it('every alias is already in the form the parser normalises to', () => {
    // An alias with a space or an underscore matches nothing: the parser compares
    // against headers that have had both stripped.
    for (const column of QUESTION_IMPORT_COLUMNS) {
      for (const alias of column.aliases) {
        assert.equal(alias, alias.toLowerCase().replace(/[\s_-]+/g, ''), `alias ${alias}`);
      }
    }
  });
});

describe('questionListQuerySchema', () => {
  it('reads present-or-absent booleans from the query string', () => {
    assert.equal(questionListQuerySchema.parse({}).isActive, undefined);
    assert.equal(questionListQuerySchema.parse({ isActive: 'false' }).isActive, false);
  });

  it('drops a blank search rather than searching for nothing', () => {
    assert.equal(questionListQuerySchema.parse({ q: '   ' }).q, undefined);
  });
});
