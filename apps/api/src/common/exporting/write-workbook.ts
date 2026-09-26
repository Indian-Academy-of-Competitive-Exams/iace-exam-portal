import { PassThrough } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import ExcelJS from 'exceljs';
import { instituteWallTime } from '@iace/contracts';

/** How a date column is drawn; the cell is a real Excel date either way, so it sorts and filters. */
export const EXPORT_DATE_FORMATS = {
  INSTANT: 'yyyy-mm-dd hh:mm',
  DAY: 'yyyy-mm-dd',
} as const;
type ExportDateFormat = (typeof EXPORT_DATE_FORMATS)[keyof typeof EXPORT_DATE_FORMATS];

const TEXT_FORMAT = '@';

export interface ExportColumn<Row> {
  header: string;
  width: number;
  /** A method, not a property: its bivariance is what lets one call take sheets of different rows. */
  value(row: Row): string | number | Date | null;
  /** Stored as text so Excel keeps a mobile's leading zero and never reads a code as a number. */
  text?: true;
  /** A `@db.Date` value goes in as it is; an instant goes through `exportInstant` first. */
  date?: ExportDateFormat;
}

export interface ExportSheet<Row = unknown> {
  name: string;
  columns: ExportColumn<Row>[];
  rows: Row[];
}

/** Excel dates carry no zone, so the cell's UTC fields are set to the institute's wall clock. */
export function exportInstant(at: Date | null): Date | null {
  return at && new Date(`${instituteWallTime(at)}:00Z`);
}

/** Yielding this often keeps sign-in and token refresh served while a large sheet is written. */
const ROWS_PER_YIELD = 1_000;

/** Streamed row by row: the whole-model writer ran `core` out of memory at 50,000 rows × 20 columns. */
export async function writeWorkbook(sheets: ExportSheet[]): Promise<Buffer> {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk));
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: output,
    useStyles: true,
    useSharedStrings: false,
  });
  workbook.creator = 'IACE';

  for (const { name, columns, rows } of sheets) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = columns.map((column) => {
      const numFmt = column.text ? TEXT_FORMAT : column.date;
      return { header: column.header, width: column.width, style: numFmt ? { numFmt } : {} };
    });
    const header = sheet.getRow(1);
    header.eachCell((cell) => {
      cell.font = { bold: true };
    });
    header.commit();
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

    for (const [index, row] of rows.entries()) {
      sheet.addRow(columns.map((column) => column.value(row))).commit();
      if ((index + 1) % ROWS_PER_YIELD === 0) await setImmediate();
    }
    sheet.commit();
  }

  await workbook.commit();
  return Buffer.concat(chunks);
}
