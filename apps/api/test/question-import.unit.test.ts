import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  QUESTION_IMPORT_COLUMNS,
  QUESTION_TYPE,
  QUESTION_VALIDATION_CODE,
  type QuestionImportColumnKey,
} from '@iace/contracts';
import { type CsvTable, normaliseHeader } from '../src/common/importing';
import { emptyTaxonomy } from '../src/questions/question-core';
import {
  planQuestionImport,
  type ImportDedupContext,
  type QuestionImportPlanning,
} from '../src/questions/question-import';
import { topicKey, type TaxonomyCatalog } from '../src/questions/taxonomy-context';

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

describe('the question sheet', () => {
  it('plans a complete row as a create', () => {
    const result = plan([MCQ_ROW]);

    assert.deepEqual(result.summary, { total: 1, willCreate: 1, duplicates: 0, invalid: 0 });
    const row = result.rows[0]!;
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
    const row = plan([{ ...MCQ_ROW, subject: '  quantitative   aptitude ' }]).rows[0]!;
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
    ]).rows[0]!;

    assert.equal(row.action, 'create');
    assert.deepEqual(row.languages, ['en', 'hi', 'te']);
    assert.equal(row.draft?.stem.te, '150లో 20% ఎంత?');
    assert.equal(row.draft?.solution?.te, 'కూడండి');
  });

  it('reports the row rather than the file when a name is not in the bank', () => {
    const result = plan([{ ...MCQ_ROW, subject: 'Reasoning' }, MCQ_ROW]);

    assert.equal(result.summary.invalid, 1);
    assert.equal(result.summary.willCreate, 1);
    assert.deepEqual(
      result.rows[0]!.issues.map((issue) => issue.code),
      [QUESTION_VALIDATION_CODE.SUBJECT_UNKNOWN],
    );
    assert.equal(result.rows[0]!.issues[0]!.column, 'subject');
  });

  it('says a thing once, whichever check reached it', () => {
    // The sheet cannot resolve the subject and the core then finds no subject id.
    const row = plan([{ ...MCQ_ROW, subject: 'Reasoning' }]).rows[0]!;
    assert.equal(row.issues.length, 1);
  });

  it('refuses a topic that is not under that subject rather than inventing one', () => {
    const row = plan([{ ...MCQ_ROW, topic: 'Geometry' }]).rows[0]!;
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
    ]).rows[0]!;

    assert.equal(row.action, 'create');
    assert.equal(row.draft?.type, QUESTION_TYPE.TEXT_FIELD);
    assert.equal(row.draft?.answerKey?.tolerance, 0.01);
    assert.deepEqual(row.draft?.options, []);
  });

  it('splits tags on a comma and folds them to one casing', () => {
    const row = plan([{ ...MCQ_ROW, tags: 'SSC CGL, percentages ,SSC CGL' }]).rows[0]!;
    assert.deepEqual(row.draft?.tags, ['ssc cgl', 'percentages']);
  });

  it('reports a correct_option outside the four options', () => {
    const row = plan([{ ...MCQ_ROW, correct_option: '5' }]).rows[0]!;
    assert.ok(
      row.issues.some((issue) => issue.code === QUESTION_VALIDATION_CODE.CORRECT_OPTION_INVALID),
    );
  });

  it('treats an empty option slot as a missing option, not as empty text', () => {
    const row = plan([{ ...MCQ_ROW, option4_en: '' }]).rows[0]!;
    assert.deepEqual(
      row.issues.map((issue) => issue.code),
      [QUESTION_VALIDATION_CODE.OPTION_COUNT_INVALID],
    );
  });
});

describe('the question sheet — duplicates', () => {
  it('skips a question already in the bank without calling it an error', () => {
    const first = plan([MCQ_ROW]).rows[0]!;
    const dedup: ImportDedupContext = {
      questionIdByHash: new Map([[first.stemHash!, 'q_existing']]),
      questionIdByCode: new Map(),
    };

    const result = plan([MCQ_ROW], dedup);
    assert.equal(result.rows[0]!.action, 'duplicate');
    assert.equal(result.rows[0]!.duplicateOf, 'q_existing');
    assert.deepEqual(result.rows[0]!.issues, []);
    assert.deepEqual(result.summary, { total: 1, willCreate: 0, duplicates: 1, invalid: 0 });
  });

  it('points the second copy in a file at the line it repeats', () => {
    const result = plan([MCQ_ROW, MCQ_ROW]);

    assert.equal(result.rows[0]!.action, 'create');
    assert.equal(result.rows[1]!.action, 'duplicate');
    assert.equal(result.rows[1]!.duplicateOf, 'line 2');
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
    assert.equal(result.rows[1]!.action, 'duplicate');
  });

  it('refuses a question code the bank has already given out', () => {
    const dedup: ImportDedupContext = {
      questionIdByHash: new Map(),
      questionIdByCode: new Map([['QA-001', 'q_existing']]),
    };
    const row = plan([{ ...MCQ_ROW, question_code: 'qa-001' }], dedup).rows[0]!;
    assert.ok(
      row.issues.some((issue) => issue.code === QUESTION_VALIDATION_CODE.QUESTION_CODE_TAKEN),
    );
  });

  it('refuses the same code twice within one file', () => {
    const result = plan([
      { ...MCQ_ROW, question_code: 'QA-001' },
      { ...MCQ_ROW, stem_en: 'What is 30% of 150?', question_code: 'QA-001' },
    ]);
    assert.equal(result.rows[1]!.action, 'skip');
  });

  it('re-uploading a sheet is duplicates, not a pile of code clashes', () => {
    // The row is already in the bank, carrying the code it was imported with.
    // Reporting that code as taken would make the normal way to use this — add
    // ten questions to last week's file and upload it again — look like errors.
    const coded = { ...MCQ_ROW, question_code: 'QA-001' };
    const first = plan([coded]).rows[0]!;

    const result = plan([coded], {
      questionIdByHash: new Map([[first.stemHash!, 'q_existing']]),
      questionIdByCode: new Map([['QA-001', 'q_existing']]),
    });

    assert.equal(result.rows[0]!.action, 'duplicate');
    assert.deepEqual(result.rows[0]!.issues, []);
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
    assert.match(result.fileErrors.join(' '), /subject/);
  });
});
