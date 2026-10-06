import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REPORT_KEYS, REPORT_MAX_ROWS } from '@iace/contracts';
import { EXPORT_DATE_FORMATS, exportInstant, type ExportSheet } from '../src/common/exporting';
import { aboutSheet, toDocument, type Report } from '../src/reports/report';

interface Row {
  name: string;
  mobile: string;
  submittedAt: Date;
}

const sheetOf = (rows: Row[]): ExportSheet<Row> => ({
  name: 'Results',
  columns: [
    { header: 'Student', width: 20, value: (row) => row.name },
    { header: 'Mobile', width: 14, fileOnly: true, value: (row) => row.mobile },
    {
      header: 'Submitted at',
      width: 18,
      date: EXPORT_DATE_FORMATS.INSTANT,
      value: (row) => exportInstant(row.submittedAt),
    },
  ],
  rows,
});

const reportOf = (rows: Row[]): Report => ({
  about: [{ label: 'Test', value: 'Mock 1' }],
  figures: [{ label: 'Ranked sittings', value: rows.length }],
  sheets: [sheetOf(rows)],
});

const ANA: Row = {
  name: 'Ana',
  mobile: '9000000001',
  submittedAt: new Date('2026-06-01T20:00:00Z'),
};

describe('toDocument', () => {
  it('leaves a file-only column off the page and reads an instant on the institute clock', () => {
    const [table] = toDocument(REPORT_KEYS.TEST_RESULTS, reportOf([ANA])).tables;

    assert.deepEqual(table?.columns, ['Student', 'Submitted at']);
    // 20:00 UTC is 01:30 the next morning in Kolkata.
    assert.match(String(table?.rows[0]?.[1]), /^2 Jun 2026, 1:30\s?am$/);
  });

  it('cuts a table at the page limit and still says how many rows there are', () => {
    const rows = Array.from({ length: REPORT_MAX_ROWS + 3 }, () => ANA);

    const [table] = toDocument(REPORT_KEYS.TEST_RESULTS, reportOf(rows)).tables;

    assert.equal(table?.rows.length, REPORT_MAX_ROWS);
    assert.equal(table?.total, REPORT_MAX_ROWS + 3);
  });
});

describe('aboutSheet', () => {
  it('names the report, what it covers and when it was true', () => {
    const sheet = aboutSheet(
      REPORT_KEYS.TEST_RESULTS,
      reportOf([ANA]),
      new Date('2026-06-01T20:00:00Z'),
    );

    const labels = sheet.rows.map((row) => sheet.columns[0]?.value(row));
    assert.deepEqual(labels, ['Report', 'Test', 'Ranked sittings', 'As of']);
    assert.equal(sheet.columns[1]?.value(sheet.rows[0]), 'Result sheet');
    assert.match(String(sheet.columns[1]?.value(sheet.rows[3])), /^2 Jun 2026, 1:30\s?am$/);
  });
});
