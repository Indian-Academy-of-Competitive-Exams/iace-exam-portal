import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { AppException, EXPORT_MAX_ROWS, ErrorCodes } from '@iace/contracts';
import {
  EXPORT_DATE_FORMATS,
  assertExportable,
  exportInstant,
  writeWorkbook,
  type ExportSheet,
} from '../src/common/exporting';
import { readUploadedTable } from '../src/common/importing';

interface Person {
  mobile: string;
  stem: string;
  score: number;
  submittedAt: Date | null;
  dob: Date;
}

const PEOPLE: ExportSheet<Person> = {
  name: 'Results',
  columns: [
    { header: 'Mobile', width: 14, value: (row) => row.mobile, text: true },
    { header: 'Stem', width: 30, value: (row) => row.stem },
    { header: 'Score', width: 8, value: (row) => row.score },
    {
      header: 'Submitted at',
      width: 20,
      value: (row) => exportInstant(row.submittedAt),
      date: EXPORT_DATE_FORMATS.INSTANT,
    },
    { header: 'DOB', width: 12, value: (row) => row.dob, date: EXPORT_DATE_FORMATS.DAY },
  ],
  rows: [
    {
      mobile: '0987654321',
      stem: '=SUM(A1)',
      score: 42.5,
      submittedAt: new Date('2026-09-25T19:00:00Z'),
      dob: new Date('2003-04-11T00:00:00Z'),
    },
    {
      mobile: '9876543210',
      stem: 'plain',
      score: 7,
      submittedAt: null,
      dob: new Date('2004-01-02T00:00:00Z'),
    },
  ],
};

const SUMMARY: ExportSheet<{ label: string }> = {
  name: 'Summary',
  columns: [{ header: 'Label', width: 10, value: (row) => row.label }],
  rows: [{ label: 'only' }],
};

async function load(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

async function resultsSheet(): Promise<ExcelJS.Worksheet> {
  const sheet = (await load(await writeWorkbook([PEOPLE]))).getWorksheet('Results');
  assert.ok(sheet);
  return sheet;
}

describe('writeWorkbook', () => {
  it('reads back through the importer with headers, rows and values as written', async () => {
    const table = await readUploadedTable(await writeWorkbook([PEOPLE]));

    assert.deepEqual(table.headers, ['mobile', 'stem', 'score', 'submittedat', 'dob']);
    assert.deepEqual(
      table.rows.map((row) => row.values),
      [
        {
          mobile: '0987654321',
          stem: '=SUM(A1)',
          score: '42.5',
          submittedat: '2026-09-26',
          dob: '2003-04-11',
        },
        { mobile: '9876543210', stem: 'plain', score: '7', submittedat: '', dob: '2004-01-02' },
      ],
    );
  });

  it('keeps a formula-looking stem a string, never a formula', async () => {
    const sheet = await resultsSheet();

    assert.equal(sheet.getCell('B2').value, '=SUM(A1)');
    assert.equal(sheet.getCell('A2').numFmt, '@');
  });

  it('bolds, freezes and filters the header row', async () => {
    const sheet = await resultsSheet();

    assert.equal(sheet.getCell('A1').font?.bold, true);
    assert.equal(sheet.getCell('D1').font?.bold, true);
    assert.deepEqual(
      sheet.views.map((view) => [view.state, (view as { ySplit?: number }).ySplit]),
      [['frozen', 1]],
    );
    assert.ok(sheet.autoFilter, 'the header row carries an autofilter');
  });

  it('keeps several sheets in order under their names', async () => {
    const workbook = await load(await writeWorkbook([PEOPLE, SUMMARY]));

    assert.deepEqual(
      workbook.worksheets.map((sheet) => sheet.name),
      ['Results', 'Summary'],
    );
  });
});

describe('exportInstant', () => {
  it('writes a real date cell holding the IST wall time, the next day while UTC is before midnight', async () => {
    const sheet = await resultsSheet();

    assert.deepEqual(sheet.getCell('D2').value, new Date('2026-09-26T00:30:00Z'));
    assert.equal(sheet.getCell('D2').numFmt, EXPORT_DATE_FORMATS.INSTANT);
    assert.equal(sheet.getCell('D3').value, null);
  });

  it('writes a civil date as the day it names', async () => {
    const sheet = await resultsSheet();

    assert.deepEqual(sheet.getCell('E2').value, new Date('2003-04-11T00:00:00Z'));
    assert.equal(sheet.getCell('E2').numFmt, EXPORT_DATE_FORMATS.DAY);
  });
});

describe('assertExportable', () => {
  it('passes at the cap', () => {
    assert.doesNotThrow(() => assertExportable(EXPORT_MAX_ROWS));
  });

  it('refuses one row over it, naming the count and the cap', () => {
    assert.throws(
      () => assertExportable(EXPORT_MAX_ROWS + 1),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.EXPORT_TOO_LARGE);
        assert.match(error.message, /50,001/);
        assert.match(error.message, /50,000/);
        return true;
      },
    );
  });
});
