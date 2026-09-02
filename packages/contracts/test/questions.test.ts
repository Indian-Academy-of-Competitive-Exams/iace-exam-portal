import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DIFFICULTY_LEVEL,
  LANGUAGE_ORDER,
  MCQ_OPTION_COUNT,
  MCQ_OPTION_MAX,
  QUESTION_IMPORT_COLUMNS,
  QUESTION_INTAKE_STATUSES,
  QUESTION_TYPE,
  SUPPORTED_LANGUAGES,
  hasText,
  localizedTextSchema,
  previewTextOf,
  questionDraftSchema,
  questionImportCommitSchema,
  questionIntakeStatusSchema,
  questionListQuerySchema,
  tagSchema,
  topicNameSchema,
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
  it('defaults type, options and tags so a bare draft parses', () => {
    const parsed = questionDraftSchema.parse(draft());
    assert.equal(parsed.type, QUESTION_TYPE.SINGLE_MCQ);
    assert.deepEqual(parsed.tags, []);
  });

  /**
   * NOT defaulted, deliberately: a defaulted status turns every save that omits it into an
   * un-archive, which puts a retired question back into the next paper.
   */
  it('leaves an omitted status absent rather than assuming ACTIVE', () => {
    assert.equal(questionDraftSchema.parse(draft()).status, undefined);
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

  const withOptions = (count: number) =>
    draft({
      options: Array.from({ length: count }, (_, i) => ({
        position: i + 1,
        isCorrect: i === 0,
        text: { en: String(i) },
      })),
    });

  it('takes the five and six an SBI PO paper prints', () => {
    assert.equal(questionDraftSchema.safeParse(withOptions(MCQ_OPTION_COUNT)).success, true);
    assert.equal(questionDraftSchema.safeParse(withOptions(MCQ_OPTION_MAX)).success, true);
  });

  it('refuses more options than any paper prints', () => {
    assert.equal(questionDraftSchema.safeParse(withOptions(MCQ_OPTION_MAX + 1)).success, false);
  });
});

describe('names, tags and codes are normalised rather than refused', () => {
  it('canonicalises a topic name', () => {
    assert.equal(topicNameSchema.parse('  arithmetic   basics '), 'ARITHMETIC BASICS');
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
  const parse = (input: Record<string, unknown>) => questionListQuerySchema.parse(input);

  it('reads an absent status as "any", and a named one as a set of one', () => {
    assert.equal(parse({}).status, undefined);
    assert.deepEqual(parse({ status: 'ARCHIVED' }).status, ['ARCHIVED']);
  });

  it('narrows to several statuses at once', () => {
    assert.deepEqual(parse({ status: 'DRAFT,ARCHIVED' }).status, ['DRAFT', 'ARCHIVED']);
  });

  /** A screen holds a set; the URL holds CSV. Both have to reach the same query. */
  it('takes the set itself, not only the joined form', () => {
    assert.deepEqual(parse({ difficulty: ['LOW', 'HIGH'] }).difficulty, ['LOW', 'HIGH']);
    assert.deepEqual(parse({ difficulty: 'LOW,HIGH' }).difficulty, ['LOW', 'HIGH']);
  });

  /** `in: []` matches nothing, so an emptied filter has to read as "any" rather than "none". */
  it('reads an emptied filter as absent', () => {
    assert.equal(parse({ subjectId: [] }).subjectId, undefined);
    assert.equal(parse({ subjectId: '' }).subjectId, undefined);
  });

  it('still refuses a status nobody defined', () => {
    assert.equal(questionListQuerySchema.safeParse({ status: 'RETIRED' }).success, false);
    assert.equal(questionListQuerySchema.safeParse({ status: 'DRAFT,RETIRED' }).success, false);
  });

  it('drops a blank search rather than searching for nothing', () => {
    assert.equal(parse({ q: '   ' }).q, undefined);
  });
});

describe('what a question may be created as', () => {
  /** ARCHIVED is a retirement. Offering it at intake would let a question arrive already dead. */
  it('offers draft and active, never archived', () => {
    assert.deepEqual([...QUESTION_INTAKE_STATUSES], ['DRAFT', 'ACTIVE']);
    assert.equal(questionIntakeStatusSchema.safeParse('ARCHIVED').success, false);
  });

  /** An older client that names no status must not put a whole sheet live by omission. */
  it('lands an import in review when the commit names no status', () => {
    const parsed = questionImportCommitSchema.parse({ importLogId: 'imp_1' });

    assert.equal(parsed.status, 'DRAFT');
  });

  it('takes the status the run chose', () => {
    const parsed = questionImportCommitSchema.parse({ importLogId: 'imp_1', status: 'ACTIVE' });

    assert.equal(parsed.status, 'ACTIVE');
  });
});

describe('previewTextOf', () => {
  /** The bug: a list cell rendered `<p>Solve <span data-latex=...` at the reader, verbatim. */
  it('gives back the question, not its markup', () => {
    assert.equal(
      previewTextOf('<p><strong>Bold</strong> and <em>italic</em></p>'),
      'Bold and italic',
    );
  });

  /** An author recognises their own LaTeX; they would not recognise an empty span. */
  it('keeps a formula as the LaTeX it was written as', () => {
    const html = '<p>Solve <span data-type="inline-math" data-latex="x^2"></span> for x</p>';

    assert.equal(previewTextOf(html), 'Solve x^2 for x');
  });

  /** A cell cannot show a picture, and an image tag says less than the word does. */
  it('says an image is there rather than printing its tag', () => {
    const html = '<p>Study the figure</p><img data-key="questions/images/a.png">';

    assert.equal(previewTextOf(html), 'Study the figure [image]');
  });

  it('keeps list items apart rather than running them together', () => {
    assert.equal(previewTextOf('<ul><li>One</li><li>Two</li></ul>'), 'One Two');
  });

  /** A comparison is ordinary in a maths question, and `&lt;` is not what was typed. */
  it('reads entities back as the characters they stand for', () => {
    assert.equal(previewTextOf('<p>If a &lt; b and b &gt; c</p>'), 'If a < b and b > c');
  });

  it('leaves plain text exactly as it is', () => {
    assert.equal(previewTextOf('What is 20% of 150?'), 'What is 20% of 150?');
  });

  it('collapses the whitespace tags leave behind', () => {
    assert.equal(previewTextOf('<div><p>a</p>\n\n<p>b</p></div>'), 'a b');
  });
});

describe('hasText', () => {
  /** The bug: an emptied editor box posts `<p></p>`, and the bank took it as an answered field. */
  it('reads an emptied editor box as nothing at all', () => {
    assert.equal(hasText('<div><p></p></div>'), false);
    assert.equal(hasText('<p><br></p>'), false);
    assert.equal(hasText('   '), false);
    assert.equal(hasText(undefined), false);
  });

  /** A figure is a whole question in reasoning papers, with not one word beside it. */
  it('counts a lone image as something the reader can see', () => {
    assert.equal(hasText('<div><img data-key="questions/images/a.png"></div>'), true);
  });

  it('counts text and formulas', () => {
    assert.equal(hasText('<div><p>Two</p></div>'), true);
    assert.equal(hasText('<p><span data-latex="x^2"></span></p>'), true);
  });
});
