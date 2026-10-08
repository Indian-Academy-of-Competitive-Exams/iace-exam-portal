import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  QUESTION_IMPORT_COLUMNS,
  QUESTION_IMPORT_MAX_ROWS,
  QUESTION_IMPORT_TAG,
  QUESTION_TYPE,
  QUESTION_VALIDATION_CODE,
  SECTION_IMPORT_MAX_ROWS,
  TAG_SEPARATOR,
  TAGS_MAX,
  type QuestionDraft,
  type QuestionImportColumnKey,
} from '@iace/contracts';
import { type CsvTable, normaliseHeader } from '../src/common/importing';
import { htmlFromCell } from '../src/questions/question-content';
import { computeStemHash, emptyTaxonomy } from '../src/questions/question-core';
import {
  planQuestionImport,
  type ImportDedupContext,
  type ImportScope,
  type QuestionImportPlanning,
} from '../src/questions/question-import';
import { topicKey, type TaxonomyCatalog } from '../src/questions/taxonomy-context';
import { rowAt } from './support/fakes';

const CODE = QUESTION_VALIDATION_CODE;
const SUBJECT = 'sub_quant';
const TOPIC = 'top_arithmetic';
const ALGEBRA = 'top_algebra';

function catalog(): TaxonomyCatalog {
  const context = emptyTaxonomy();
  context.subjects.set(SUBJECT, { id: SUBJECT, name: 'QUANTITATIVE APTITUDE' });
  context.topics.set(TOPIC, { id: TOPIC, name: 'ARITHMETIC', subjectId: SUBJECT });
  context.topics.set(ALGEBRA, { id: ALGEBRA, name: 'ALGEBRA', subjectId: SUBJECT });

  return {
    context,
    subjects: [
      {
        id: SUBJECT,
        name: 'QUANTITATIVE APTITUDE',
        topics: [
          { id: TOPIC, name: 'ARITHMETIC' },
          { id: ALGEBRA, name: 'ALGEBRA' },
        ],
      },
    ],
    subjectIdByName: new Map([['QUANTITATIVE APTITUDE', SUBJECT]]),
    topicIdBySubjectAndName: new Map([
      [topicKey(SUBJECT, 'ARITHMETIC'), TOPIC],
      [topicKey(SUBJECT, 'ALGEBRA'), ALGEBRA],
    ]),
  };
}

const noDedup = (): ImportDedupContext => ({
  questionIdByHash: new Map(),
  questionIdByCode: new Map(),
});

/** A full MCQ row, by column key, before any override. */
const MCQ_ROW: Partial<Record<QuestionImportColumnKey, string>> = {
  subject: 'Quantitative Aptitude',
  topic: 'Arithmetic',
  difficulty: 'medium',
  stem_en: 'What is 20% of 150?',
  option1_en: '25',
  option2_en: '30',
  option3_en: '35',
  option4_en: '40',
  correct_option: '2',
};

/** Builds the table the reader would produce, with the headers it normalises to. */
function table(...rows: Partial<Record<QuestionImportColumnKey, string>>[]): CsvTable {
  const headers = QUESTION_IMPORT_COLUMNS.map((column) => normaliseHeader(column.header));

  return {
    headers,
    rows: rows.map((row, index) => ({
      // Line 1 is the header, so the first data row is line 2 — what Excel shows.
      line: index + 2,
      values: Object.fromEntries(
        QUESTION_IMPORT_COLUMNS.map((column) => [
          normaliseHeader(column.header),
          row[column.key as QuestionImportColumnKey] ?? '',
        ]),
      ),
    })),
  };
}

const plan = (
  rows: Partial<Record<QuestionImportColumnKey, string>>[],
  dedup: ImportDedupContext = noDedup(),
): QuestionImportPlanning => planQuestionImport(table(...rows), catalog(), dedup);

describe('a sheet imported into one section of a test', () => {
  const QUANT = { id: SUBJECT, name: 'QUANTITATIVE APTITUDE' };
  const sheetOf = (count: number) =>
    Array.from({ length: count }, (_, at) => ({
      ...MCQ_ROW,
      stem_en: `What is ${at + 1}% of 9731?`,
    }));
  const within = (subject: ImportScope['subject'], count = 3) =>
    planQuestionImport(table(...sheetOf(count)), catalog(), noDedup(), undefined, undefined, {
      sectionName: 'Quant',
      subject,
    });
  const codes = (planning: QuestionImportPlanning) =>
    planning.rows.map((row) => row.issues[0]?.code ?? row.action);

  it('skips a row filed under a subject the section does not take', () => {
    const planning = within({ id: 'sub_english', name: 'ENGLISH' });

    assert.deepEqual(
      codes(planning),
      [1, 2, 3].map(() => CODE.SUBJECT_OUTSIDE_SECTION),
    );
    assert.match(
      planning.rows[0]?.issues[0]?.message ?? '',
      /Only ENGLISH questions go into Quant/,
    );
  });

  it('takes any subject where the section names none', () => {
    assert.deepEqual(codes(within(null)), ['create', 'create', 'create']);
  });

  /** The failure this prevents: a sheet of hundreds landing on one proof-reader in one go. */
  it('refuses a sheet past the section’s limit, which is tighter than the bank’s', () => {
    const over = SECTION_IMPORT_MAX_ROWS + 1;

    assert.equal(within(QUANT, SECTION_IMPORT_MAX_ROWS).fileErrors.length, 0);
    assert.match(
      within(QUANT, over).fileErrors[0] ?? '',
      new RegExp(`${over} rows. Import at most ${SECTION_IMPORT_MAX_ROWS} at a time into Quant`),
    );
    assert.equal(plan(sheetOf(over)).fileErrors.length, 0);
    assert.match(
      plan(sheetOf(QUESTION_IMPORT_MAX_ROWS + 1)).fileErrors[0] ?? '',
      new RegExp(`Import at most ${QUESTION_IMPORT_MAX_ROWS} at a time\\.`),
    );
  });
});

describe('the question sheet', () => {
  it('plans a complete row as a create', () => {
    const result = plan([MCQ_ROW]);

    assert.deepEqual(result.summary, {
      total: 1,
      willCreate: 1,
      duplicates: 0,
      invalid: 0,
      leftOut: 0,
    });
    const row = rowAt(result.rows);
    assert.equal(row.line, 2);
    assert.equal(row.action, 'create');
    assert.deepEqual(row.issues, []);
    assert.equal(row.draft?.subjectId, SUBJECT);
    assert.equal(row.draft?.topicId, TOPIC);
    assert.equal(row.draft?.type, QUESTION_TYPE.SINGLE_MCQ);
    assert.equal(row.draft?.difficulty, 'MEDIUM');
    assert.equal(row.draft?.options[1]?.isCorrect, true);
  });

  it('resolves taxonomy by name, however it was typed', () => {
    const row = plan([{ ...MCQ_ROW, subject: '  quantitative   aptitude ' }]).rows[0];
    assert.ok(row);
    assert.equal(row.action, 'create');
    assert.equal(row.draft?.subjectId, SUBJECT);
  });

  it('reads all three languages into one question', () => {
    const row = plan([
      {
        ...MCQ_ROW,
        stem_hi: '150 का 20% कितना है?',
        stem_te: '150లో 20% ఎంత?',
        option1_hi: '25',
        option2_hi: '30',
        option3_hi: '35',
        option4_hi: '40',
        option1_te: '25',
        option2_te: '30',
        option3_te: '35',
        option4_te: '40',
        solution_te: 'కూడండి',
      },
    ]).rows[0];
    assert.ok(row);

    assert.equal(row.action, 'create');
    assert.deepEqual(row.languages, ['en', 'hi', 'te']);
    assert.equal(row.draft?.stem.te, '<p>150లో 20% ఎంత?</p>');
    assert.equal(row.draft?.solution?.te, '<p>కూడండి</p>');
  });

  it('reports the row rather than the file when a name is not in the bank', () => {
    const result = plan([{ ...MCQ_ROW, subject: 'Reasoning' }, MCQ_ROW]);

    assert.equal(result.summary.invalid, 1);
    assert.equal(result.summary.willCreate, 1);
    assert.deepEqual(
      result.rows[0]?.issues.map((issue) => issue.code),
      [QUESTION_VALIDATION_CODE.SUBJECT_UNKNOWN],
    );
    assert.equal(result.rows[0]?.issues[0]?.column, 'subject');
  });

  it('says a thing once, whichever check reached it', () => {
    // The sheet cannot resolve the subject and the core then finds no subject id.
    const row = plan([{ ...MCQ_ROW, subject: 'Reasoning' }]).rows[0];
    assert.ok(row);
    assert.equal(row.issues.length, 1);
  });

  it('refuses a topic that is not under that subject rather than inventing one', () => {
    const row = plan([{ ...MCQ_ROW, topic: 'Geometry' }]).rows[0];
    assert.ok(row);
    assert.ok(row.issues.some((issue) => issue.code === QUESTION_VALIDATION_CODE.TOPIC_UNKNOWN));
    assert.equal(row.action, 'skip');
  });

  it('reads a typed-answer row', () => {
    const row = plan([
      {
        subject: 'Quantitative Aptitude',
        difficulty: 'LOW',
        type: 'TEXT_FIELD',
        stem_en: 'Write pi to two decimal places.',
        answer_mode: 'NUMERIC',
        answer_en: '3.14',
        answer_tolerance: '0.01',
      },
    ]).rows[0];
    assert.ok(row);

    assert.equal(row.action, 'create');
    assert.equal(row.draft?.type, QUESTION_TYPE.TEXT_FIELD);
    assert.equal(row.draft?.answerKey?.tolerance, 0.01);
    assert.deepEqual(row.draft?.options, []);
  });

  /** The sheet took any number from zero up, so 5000 previewed as Create and the review save refused it. */
  it('skips a row whose tolerance is not one the save would take, and says which cell', () => {
    for (const answer_tolerance of ['5000', '-1', 'abc']) {
      const row = plan([
        {
          subject: 'Quantitative Aptitude',
          difficulty: 'LOW',
          type: 'TEXT_FIELD',
          stem_en: 'Write pi to two decimal places.',
          answer_mode: 'NUMERIC',
          answer_en: '3.14',
          answer_tolerance,
        },
      ]).rows[0];

      assert.equal(row?.action, 'skip', answer_tolerance);
      assert.deepEqual(
        row?.issues.map((issue) => [issue.code, issue.column]),
        [[QUESTION_VALIDATION_CODE.ANSWER_NOT_NUMERIC, 'answer_tolerance']],
        answer_tolerance,
      );
      // The review window parses this draft, so it must not carry what the schema refuses.
      assert.equal(row?.editable.answerKey?.tolerance, undefined, answer_tolerance);
    }
  });

  it('splits tags on a comma and folds them to one casing', () => {
    const row = plan([{ ...MCQ_ROW, tags: 'SSC CGL, percentages ,SSC CGL' }]).rows[0];
    assert.ok(row);
    assert.deepEqual(row.draft?.tags, [QUESTION_IMPORT_TAG, 'ssc cgl', 'percentages']);
  });

  it('reports a correct_option outside the four options', () => {
    const row = plan([{ ...MCQ_ROW, correct_option: '5' }]).rows[0];
    assert.ok(row);
    assert.ok(
      row.issues.some((issue) => issue.code === QUESTION_VALIDATION_CODE.CORRECT_OPTION_INVALID),
    );
  });

  it('reads a trailing empty option column as a question with fewer options', () => {
    const row = plan([{ ...MCQ_ROW, option4_en: '' }]).rows[0];
    assert.ok(row);

    assert.deepEqual(row.issues, []);
    assert.equal(row.draft?.options.length, 3);
  });

  it('refuses an empty column with a filled one after it, which is a gap and not a count', () => {
    const row = plan([{ ...MCQ_ROW, option3_en: '' }]).rows[0];
    assert.ok(row);

    assert.deepEqual(
      row.issues.map((issue) => issue.code),
      [QUESTION_VALIDATION_CODE.OPTION_COUNT_INVALID],
    );
  });
});

describe('the question sheet — a cell is text', () => {
  /** The bug: the cell was stored raw, and every reader of content treats it as html. */
  it('escapes a comparison rather than losing the half that looks like a tag', () => {
    const row = plan([{ ...MCQ_ROW, stem_en: 'If a<b and c>d, what is x?' }]).rows[0];
    assert.ok(row);

    assert.equal(row.action, 'create');
    assert.equal(row.draft?.stem.en, '<p>If a&lt;b and c&gt;d, what is x?</p>');
    assert.equal(row.stemPreview, 'If a<b and c>d, what is x?');
  });

  it('shows a tag typed into a cell rather than obeying it', () => {
    const row = plan([{ ...MCQ_ROW, option1_en: '<b>25</b>' }]).rows[0];
    assert.ok(row);

    assert.equal(row.draft?.options[0]?.text.en, '<p>&lt;b&gt;25&lt;/b&gt;</p>');
  });

  /** Escaping must not hide a question behind its markup: the bank holds this one already. */
  it('recognises the question the form wrote as the one the sheet repeats', () => {
    const authored = computeStemHash({
      type: QUESTION_TYPE.SINGLE_MCQ,
      stem: { en: '<div><p>What is <em>20%</em> of 150?</p></div>' },
      options: [25, 30, 35, 40].map((text, index) => ({
        position: index + 1,
        isCorrect: index === 1,
        text: { en: `<div><p>${text}</p></div>` },
      })),
      answerKey: null,
    });

    const row = plan([MCQ_ROW], {
      questionIdByHash: new Map([[authored, 'q_from_the_form']]),
      questionIdByCode: new Map(),
    }).rows[0];
    assert.ok(row);

    assert.equal(row.action, 'duplicate');
    assert.equal(row.duplicateOf, 'q_from_the_form');
  });
});

describe('the question sheet — where a question came from', () => {
  /** One filter on the bank has to answer "what did that upload bring in". */
  it('marks a question the sheet created, even one that named no tags', () => {
    const row = plan([MCQ_ROW]).rows[0];
    assert.ok(row);

    assert.deepEqual(row.draft?.tags, [QUESTION_IMPORT_TAG]);
  });

  /** The mark takes one of the ten, so a row that filled them is over and says why. */
  it('refuses a row whose own tags leave no room for the mark', () => {
    const asked = Array.from({ length: TAGS_MAX }, (_, index) => `tag${index}`);
    const row = plan([{ ...MCQ_ROW, tags: asked.join(TAG_SEPARATOR) }]).rows[0];
    assert.ok(row);

    assert.equal(row.action, 'skip');
    assert.equal(row.issues[0]?.code, QUESTION_VALIDATION_CODE.TAG_INVALID);
    assert.equal(row.draft, null);
  });

  it('leaves room for the tags the sheet does ask for', () => {
    const asked = Array.from({ length: TAGS_MAX - 1 }, (_, index) => `tag${index}`);
    const row = plan([{ ...MCQ_ROW, tags: asked.join(TAG_SEPARATOR) }]).rows[0];
    assert.ok(row);

    assert.equal(row.action, 'create');
    assert.deepEqual(row.draft?.tags, [QUESTION_IMPORT_TAG, ...asked]);
  });
});

describe('the question sheet — duplicates', () => {
  it('skips a question already in the bank without calling it an error', () => {
    const first = plan([MCQ_ROW]).rows[0];
    assert.ok(first);
    const dedup: ImportDedupContext = {
      questionIdByHash: new Map([[first.stemHash ?? '', 'q_existing']]),
      questionIdByCode: new Map(),
    };

    const result = plan([MCQ_ROW], dedup);
    assert.equal(result.rows[0]?.action, 'duplicate');
    assert.equal(result.rows[0]?.duplicateOf, 'q_existing');
    assert.deepEqual(result.rows[0]?.issues, []);
    assert.deepEqual(result.summary, {
      total: 1,
      willCreate: 0,
      duplicates: 1,
      invalid: 0,
      leftOut: 0,
    });
  });

  it('points the second copy in a file at the line it repeats', () => {
    const result = plan([MCQ_ROW, MCQ_ROW]);

    assert.equal(result.rows[0]?.action, 'create');
    assert.equal(result.rows[1]?.action, 'duplicate');
    assert.equal(result.rows[1]?.duplicateOf, 'line 2');
  });

  it('sees through a reordered set of options', () => {
    const shuffled = {
      ...MCQ_ROW,
      option1_en: '30',
      option2_en: '25',
      option3_en: '40',
      option4_en: '35',
      correct_option: '1',
    };
    const result = plan([MCQ_ROW, shuffled]);
    assert.equal(result.rows[1]?.action, 'duplicate');
  });

  it('refuses a question code the bank has already given out', () => {
    const dedup: ImportDedupContext = {
      questionIdByHash: new Map(),
      questionIdByCode: new Map([['QA-001', 'q_existing']]),
    };
    const row = plan([{ ...MCQ_ROW, question_code: 'qa-001' }], dedup).rows[0];
    assert.ok(row);
    assert.ok(
      row.issues.some((issue) => issue.code === QUESTION_VALIDATION_CODE.QUESTION_CODE_TAKEN),
    );
  });

  it('refuses the same code twice within one file', () => {
    const result = plan([
      { ...MCQ_ROW, question_code: 'QA-001' },
      { ...MCQ_ROW, stem_en: 'What is 30% of 150?', question_code: 'QA-001' },
    ]);
    assert.equal(result.rows[1]?.action, 'skip');
  });

  it('re-uploading a sheet is duplicates, not a pile of code clashes', () => {
    // The row is already in the bank, carrying the code it was imported with. Reporting that code as taken would make the normal way to use this — add ten questions to last week's file and upload it again — look like errors.
    const coded = { ...MCQ_ROW, question_code: 'QA-001' };
    const first = plan([coded]).rows[0];
    assert.ok(first);

    const result = plan([coded], {
      questionIdByHash: new Map([[first.stemHash ?? '', 'q_existing']]),
      questionIdByCode: new Map([['QA-001', 'q_existing']]),
    });

    assert.equal(result.rows[0]?.action, 'duplicate');
    assert.deepEqual(result.rows[0]?.issues, []);
  });
});

describe('the question sheet — the file itself', () => {
  it('reports an empty file as a file problem, not as a row', () => {
    const result = planQuestionImport({ headers: [], rows: [] }, catalog(), noDedup());
    assert.deepEqual(result.rows, []);
    assert.equal(result.fileErrors.length, 1);
  });

  it('names a required column that is missing', () => {
    const complete = table(MCQ_ROW);
    const stripped: CsvTable = {
      headers: complete.headers.filter((header) => header !== 'subject'),
      rows: complete.rows,
    };

    const result = planQuestionImport(stripped, catalog(), noDedup());
    assert.match(result.fileErrors.join(' '), /Subject/);
  });

  /** The failure this prevents: renaming a header rejecting every sheet an admin filled in before. */
  it('still reads a sheet written with the old snake_case headers', () => {
    const legacy = (row: Partial<Record<QuestionImportColumnKey, string>>): CsvTable => ({
      headers: QUESTION_IMPORT_COLUMNS.map((column) => normaliseHeader(column.key)),
      rows: [
        {
          line: 2,
          values: Object.fromEntries(
            QUESTION_IMPORT_COLUMNS.map((column) => [
              normaliseHeader(column.key),
              row[column.key] ?? '',
            ]),
          ),
        },
      ],
    });

    const result = planQuestionImport(legacy(MCQ_ROW), catalog(), noDedup());

    assert.deepEqual(result.fileErrors, []);
    assert.deepEqual(result.rows[0]?.issues, []);
  });
});

/** A 1×1 PNG: the smallest bytes the image sniffer accepts. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const headerOf = (key: QuestionImportColumnKey): string =>
  normaliseHeader(QUESTION_IMPORT_COLUMNS.find((column) => column.key === key)?.header ?? key);

function planWithPictures(
  row: Partial<Record<QuestionImportColumnKey, string>>,
  pictures: Partial<Record<QuestionImportColumnKey, Buffer[]>>,
): QuestionImportPlanning {
  const sheet = table(row);
  const [only] = sheet.rows;
  if (only) {
    only.pictures = Object.fromEntries(
      Object.entries(pictures).map(([key, bytes]) => [
        headerOf(key as QuestionImportColumnKey),
        bytes,
      ]),
    );
  }
  return planQuestionImport(sheet, catalog(), noDedup());
}

describe('htmlFromCell', () => {
  it('drops the pictures into the gaps when there is one gap per picture', () => {
    assert.equal(
      htmlFromCell('If   , find   .', ['a.png', 'b.png']),
      '<p>If <img data-key="a.png" alt="">, find <img data-key="b.png" alt="">.</p>',
    );
  });

  /** The failure this prevents: a picture landing in a gap it was never lifted out of. */
  it('puts the pictures after the text when the gaps do not match them one for one', () => {
    assert.equal(
      htmlFromCell('If   , then what is   ?', ['a.png']),
      '<p>If   , then what is   ?</p><p><img data-key="a.png" alt=""></p>',
    );
  });

  it('turns \\( … \\) into the same inline formula the editor writes', () => {
    assert.equal(
      htmlFromCell(String.raw`If \( \sin A = \frac{m}{n} \), find x < 2`, []),
      String.raw`<p>If <span data-type="inline-math" data-latex="\sin A = \frac{m}{n}"></span>, find x &lt; 2</p>`,
    );
  });

  it('escapes a formula so it cannot close its own attribute', () => {
    assert.match(htmlFromCell(String.raw`\( a"b \)`, []), /data-latex="a&quot;b"/);
  });

  it('leaves a cell without pictures exactly as before, gaps and all', () => {
    assert.equal(htmlFromCell('a   b', []), '<p>a   b</p>');
  });
});

describe('planQuestionImport — pictures placed over the sheet', () => {
  it('takes an option that is only a picture, keyed by its bytes', () => {
    const planned = planWithPictures({ ...MCQ_ROW, option2_en: '' }, { option2_en: [PNG] });
    const row = planned.rows[0];

    assert.deepEqual(row?.issues, []);
    const [key] = [...(row?.pictures.keys() ?? [])];
    assert.match(key ?? '', /^questions\/images\/[0-9a-f]{32}\.png$/);
    assert.match(row?.draft?.options[1]?.text.en ?? '', new RegExp(`data-key="${key}"`));
  });

  it('warns, without refusing, about a picture no taller than a line of text', () => {
    const row = planWithPictures({ ...MCQ_ROW, option2_en: '' }, { option2_en: [PNG] }).rows[0];

    assert.equal(row?.action, 'create');
    assert.deepEqual(
      row?.warnings.map((warning) => warning.column),
      ['option2_en'],
    );
  });

  /** The failure this prevents: a formula that will not draw reaching a candidate as red text. */
  it('refuses a cell formula KaTeX cannot draw', () => {
    const row = plan([{ ...MCQ_ROW, stem_en: String.raw`What is \( \frac{1}{ \)?` }]).rows[0];

    assert.ok(row?.issues.some((issue) => issue.code === QUESTION_VALIDATION_CODE.MATH_INVALID));
  });

  it('refuses bytes that are not an image, naming the cell', () => {
    const planned = planWithPictures(MCQ_ROW, { stem_en: [Buffer.from('not a picture')] });
    const issue = planned.rows[0]?.issues.find(
      (row) => row.code === QUESTION_VALIDATION_CODE.PICTURE_INVALID,
    );

    assert.equal(planned.rows[0]?.action, 'skip');
    assert.match(issue?.message ?? '', /Question \(English\)/);
  });

  it('refuses a picture over a column that only takes text', () => {
    const planned = planWithPictures(MCQ_ROW, { subject: [PNG] });

    assert.deepEqual(
      planned.rows[0]?.issues.map((issue) => issue.code),
      [QUESTION_VALIDATION_CODE.PICTURE_INVALID],
    );
  });
});

describe('the question sheet — a row left out', () => {
  const leavingOut = (
    lines: number[],
    ...rows: Partial<Record<QuestionImportColumnKey, string>>[]
  ) => planQuestionImport(table(...rows), catalog(), noDedup(), undefined, new Set(lines));

  it('writes nothing for it, and counts it apart from the skipped', () => {
    const result = leavingOut([2], MCQ_ROW);

    assert.equal(result.rows[0]?.action, 'left_out');
    assert.equal(result.rows[0]?.draft, null);
    assert.deepEqual(result.summary, {
      total: 1,
      willCreate: 0,
      duplicates: 0,
      invalid: 0,
      leftOut: 1,
    });
  });

  /** The failure this prevents: the copy that stays reported as a repeat of the one set aside. */
  it('holds neither its stem nor its code against a later row', () => {
    const coded = { ...MCQ_ROW, question_code: 'QA-9' };

    const result = leavingOut([2], coded, coded);

    assert.equal(result.rows[1]?.action, 'create');
    assert.deepEqual(result.rows[1]?.issues, []);
  });
});

describe('the question sheet — a row corrected in the review window', () => {
  /** The first row as the window opened it, saved back with something changed. */
  const corrected = (over: Partial<QuestionDraft>) => {
    const asRead = plan([MCQ_ROW]).rows[0]?.editable;
    assert.ok(asRead);
    const edits = new Map([[2, { ...asRead, ...over }]]);
    return planQuestionImport(table(MCQ_ROW), catalog(), noDedup(), edits).rows[0];
  };
  const tags = (count: number) => Array.from({ length: count }, (_, index) => `tag${index}`);

  /** The failure this prevents: the mark put back on top of a full set, and eleven tags written. */
  it('refuses a correction whose own tags leave no room for the mark', () => {
    const row = corrected({ tags: tags(TAGS_MAX) });

    assert.equal(row?.action, 'skip');
    assert.deepEqual(
      row?.issues.map((issue) => issue.code),
      [CODE.TAG_INVALID],
    );
    assert.match(row?.issues[0]?.message ?? '', new RegExp(`at most ${TAGS_MAX} tags`));
  });

  it('puts the mark back on a correction that left room for it', () => {
    const row = corrected({ tags: tags(TAGS_MAX - 1) });

    assert.equal(row?.action, 'create');
    assert.deepEqual(row?.draft?.tags, [QUESTION_IMPORT_TAG, ...tags(TAGS_MAX - 1)]);
  });

  it('refuses a correction whose stem is only what the sanitiser takes away', () => {
    const row = corrected({ stem: { en: '<p><img src="https://elsewhere.test/q.png"></p>' } });

    assert.equal(row?.action, 'skip');
    assert.equal(row?.issues[0]?.code, CODE.ENGLISH_STEM_REQUIRED);
  });
});
