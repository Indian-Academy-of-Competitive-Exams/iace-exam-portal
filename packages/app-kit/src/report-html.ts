/**
 * A report as one standalone page of HTML. Printed from a hidden frame on the web and handed to the
 * print service on a phone, so neither has to lay a document out: the browser paginates it, repeats
 * the column headings and breaks between rows. No tokens here: paper is ink on white.
 */
import {
  REPORT_LETTERHEAD,
  holdsFigures,
  instituteDateTimeLabel,
  type ReportCell,
  type ReportDocument,
  type ReportFact,
  type ReportTable,
} from '@iace/contracts';
import { PRINT_WATERMARK, printPageCss } from './print-page';

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Every value is a student's name, a test's title or a reason somebody typed. */
const escaped = (text: string): string => text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

const shown = (value: ReportCell): string => (value === null ? '' : escaped(String(value)));

/** A figure with nothing under it: a blank beside a label reads as a misprint. */
const NOT_KNOWN = '—';

/** A table wider than this is turned on its side rather than squeezed. */
const PORTRAIT_COLUMNS = 7;

const STYLES = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 10pt/1.35 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  header { margin-bottom: 12pt; border-bottom: 1.5pt solid; padding-bottom: 8pt; }
  .letterhead { margin: 0; font-size: 9pt; letter-spacing: 0.08em; text-transform: uppercase; }
  h1 { margin: 2pt 0 6pt; font-size: 16pt; }
  h2 { margin: 14pt 0 4pt; font-size: 11pt; break-after: avoid; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 1pt 12pt; margin: 0; }
  dt { font-weight: 600; }
  dd { margin: 0; }
  .figures { grid-template-columns: repeat(2, max-content minmax(4em, 1fr)); margin-bottom: 4pt; border: 0.5pt solid gray; padding: 6pt 8pt; }
  .as-of, .cut { margin: 6pt 0 0; font-size: 8.5pt; font-style: italic; }
  .letter { margin: 0 0 8pt; white-space: pre-wrap; }
  .closing { margin-top: 18pt; break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { border: 0.5pt solid gray; padding: 2.5pt 4pt; text-align: left; vertical-align: top; }
  th { border-bottom: 1pt solid black; }
  .n { width: 1%; text-align: right; font-variant-numeric: tabular-nums; }
  td.n { white-space: nowrap; }
`;

const fact = (row: ReportFact): string =>
  `<dt>${escaped(row.label)}</dt><dd>${shown(row.value) || NOT_KNOWN}</dd>`;

function facts(rows: readonly ReportFact[], className = ''): string {
  if (rows.length === 0) return '';
  return `<dl class="${className}">${rows.map(fact).join('')}</dl>`;
}

const paragraph = (line: string): string => `<p class="letter">${escaped(line)}</p>`;

function paragraphs(lines: readonly string[], className: string): string {
  if (lines.length === 0) return '';
  return `<div class="${className}">${lines.map(paragraph).join('')}</div>`;
}

const cellOf = (value: ReportCell): string =>
  typeof value === 'number' ? `<td class="n">${value}</td>` : `<td>${shown(value)}</td>`;

function tableOf(table: ReportTable): string {
  const head = table.columns
    .map(
      (column, at) => `<th${holdsFigures(table, at) ? ' class="n"' : ''}>${escaped(column)}</th>`,
    )
    .join('');
  const body = table.rows.map((row) => `<tr>${row.map(cellOf).join('')}</tr>`).join('');
  const cut =
    table.total > table.rows.length
      ? `<p class="cut">The first ${table.rows.length.toLocaleString('en-IN')} of ${table.total.toLocaleString('en-IN')} rows. The spreadsheet carries every one.</p>`
      : '';
  return `<section><h2>${escaped(table.title)}</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${cut}</section>`;
}

export function reportHtml(document: ReportDocument): string {
  const widest = Math.max(0, ...document.tables.map((table) => table.columns.length));
  const page = widest > PORTRAIT_COLUMNS ? 'A4 landscape' : 'A4 portrait';
  const title = escaped(document.title);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${printPageCss(page)}${STYLES}</style></head><body>${PRINT_WATERMARK}<header><p class="letterhead">${escaped(REPORT_LETTERHEAD)}</p><h1>${title}</h1>${facts(document.about)}<p class="as-of">As of ${escaped(instituteDateTimeLabel(document.asOf))}</p></header>${paragraphs(document.preface, 'preface')}${facts(document.figures, 'figures')}${document.tables.map(tableOf).join('')}${paragraphs(document.closing, 'closing')}</body></html>`;
}
