import test from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_KEYS, type ReportDocument, type ReportTable } from '@iace/contracts';
import { reportHtml } from '../src/report-html';

const table = (columns: string[], rows: ReportTable['rows'], total = rows.length): ReportTable => ({
  title: 'Results',
  columns,
  rows,
  total,
});

const documentOf = (tables: ReportTable[]): ReportDocument => ({
  key: REPORT_KEYS.TEST_RESULTS,
  title: 'Result sheet',
  asOf: '2026-06-01T20:00:00.000Z',
  about: [{ label: 'Test', value: 'Mock <1> & "final"' }],
  figures: [{ label: 'Ranked sittings', value: 2 }],
  tables,
});

test('reportHtml escapes what a person typed, so a name cannot become markup', () => {
  const html = reportHtml(documentOf([table(['Student'], [['<img src=x onerror=alert(1)>']])]));

  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('Mock &lt;1&gt; &amp; &quot;final&quot;'));
  assert.ok(!html.includes('<img'));
});

test('reportHtml turns a wide table on its side and keeps a narrow one upright', () => {
  const wide = Array.from({ length: 8 }, (_, at) => `Column ${at}`);

  assert.ok(reportHtml(documentOf([table(wide, [])])).includes('size: A4 landscape'));
  assert.ok(
    reportHtml(documentOf([table(['Student', 'Score'], [])])).includes('size: A4 portrait'),
  );
});

test('reportHtml says so on the page when a table was cut short', () => {
  const html = reportHtml(documentOf([table(['Student'], [['Ana']], 7_200)]));

  assert.ok(html.includes('The first 1 of 7,200 rows'));
});

test('reportHtml dates the page on the institute clock, and leaves a blank cell blank', () => {
  const html = reportHtml(documentOf([table(['Student', 'Score'], [['Ana', null]])]));

  // 20:00 UTC is 01:30 the next morning in Kolkata.
  assert.match(html, /As of 2 Jun 2026, 1:30\s?am/);
  assert.ok(html.includes('<td>Ana</td><td></td>'));
});
