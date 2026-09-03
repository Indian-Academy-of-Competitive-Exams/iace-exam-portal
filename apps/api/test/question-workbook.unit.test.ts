import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { QUESTION_IMPORT_COLUMNS, QUESTION_IMPORT_SHEETS } from '@iace/contracts';
import { readUploadedTable } from '../src/common/importing';
import { emptyTaxonomy } from '../src/questions/question-core';
import {
  buildQuestionTemplate,
  columnLetter,
  topicRangeName,
} from '../src/questions/question-workbook';
import { type TaxonomyCatalog } from '../src/questions/taxonomy-context';

/** Two subjects, and a topic name that appears under BOTH — the collision case. */
function catalog(): TaxonomyCatalog {
  return {
    context: emptyTaxonomy(),
    subjects: [
      {
        id: 's1',
        name: 'QUANTITATIVE APTITUDE',
        topics: [
          { id: 't1', name: 'ARITHMETIC' },
          { id: 't2', name: 'DATA INTERPRETATION' },
        ],
      },
      {
        id: 's2',
        name: 'GENERAL AWARENESS',
        topics: [{ id: 't3', name: 'ARITHMETIC' }],
      },
    ],
    subjectIdByName: new Map(),
    topicIdBySubjectAndName: new Map(),
  };
}

async function template(): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const buffer = await buildQuestionTemplate(catalog());
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

describe('the question import template', () => {
  it('carries the three tabs the format needs', async () => {
    const workbook = await template();
    assert.deepEqual(
      workbook.worksheets.map((sheet) => sheet.name),
      [
        QUESTION_IMPORT_SHEETS.QUESTIONS,
        QUESTION_IMPORT_SHEETS.INSTRUCTIONS,
        QUESTION_IMPORT_SHEETS.LISTS,
      ],
    );
  });

  it('writes exactly the columns the parser matches on', async () => {
    const workbook = await template();
    const sheet = workbook.getWorksheet(QUESTION_IMPORT_SHEETS.QUESTIONS);
    assert.ok(sheet);
    const header = sheet.getRow(1);

    const written: string[] = [];
    header.eachCell((cell) => written.push(String(cell.value)));
    assert.deepEqual(
      written,
      QUESTION_IMPORT_COLUMNS.map((column) => column.header),
    );
  });

  it('reads back through the importer, taking the Questions tab and not the lists', async () => {
    // The generated file is the commonest thing an admin uploads, so the reader
    // has to find the rows on the right tab.
    const table = await readUploadedTable(await buildQuestionTemplate(catalog()), {
      preferSheet: QUESTION_IMPORT_SHEETS.QUESTIONS,
    });

    assert.equal(table.rows.length, 2);
    assert.ok(table.headers.includes('stemen'));
    assert.match(String(table.rows[0]?.values.stemen), /20% of 150/);
  });

  it('names a topic range per subject, so a repeated topic cannot collide', async () => {
    const workbook = await template();
    const names = workbook.definedNames.model.map((entry) => entry.name);

    assert.ok(names.includes('SUBJECTS'));

    // ARITHMETIC sits under both subjects. Keyed by topic alone, one list would win
    // and the other subject's topics would silently disappear.
    assert.ok(names.includes(topicRangeName('QUANTITATIVE APTITUDE')));
    assert.ok(names.includes(topicRangeName('GENERAL AWARENESS')));
  });

  it('wires the cascade: topic follows the subject on its own row', async () => {
    const workbook = await template();
    const sheet = workbook.getWorksheet(QUESTION_IMPORT_SHEETS.QUESTIONS);
    assert.ok(sheet);

    const topicColumn = columnLetter(
      QUESTION_IMPORT_COLUMNS.findIndex((column) => column.key === 'topic') + 1,
    );
    const subjectColumn = columnLetter(
      QUESTION_IMPORT_COLUMNS.findIndex((column) => column.key === 'subject') + 1,
    );

    const validation = sheet.getCell(`${topicColumn}2`).dataValidation;
    assert.equal(validation?.type, 'list');
    assert.match(String(validation?.formulae[0]), /INDIRECT/);
    assert.match(String(validation?.formulae[0]), new RegExp(`\\$${subjectColumn}\\$2`));
  });

  it('turns a name with spaces into a usable Excel range name', () => {
    assert.equal(topicRangeName('QUANTITATIVE APTITUDE'), 'T_QUANTITATIVE_APTITUDE');
  });

  it('numbers columns the way Excel does past Z', () => {
    assert.equal(columnLetter(1), 'A');
    assert.equal(columnLetter(26), 'Z');
    assert.equal(columnLetter(27), 'AA');
    assert.equal(columnLetter(28), 'AB');
  });

  it('still builds when the bank has no taxonomy yet', async () => {
    const empty: TaxonomyCatalog = {
      context: emptyTaxonomy(),
      subjects: [],
      subjectIdByName: new Map(),
      topicIdBySubjectAndName: new Map(),
    };
    const buffer = await buildQuestionTemplate(empty);
    assert.ok(buffer.length > 0);
  });
});
