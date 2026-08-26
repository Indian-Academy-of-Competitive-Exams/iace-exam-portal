import ExcelJS from 'exceljs';
import { AppException, ErrorCodes } from '@iace/contracts';
import { normaliseHeader, readCsvTable, type CsvTable } from './csv';
import { toIsoDate } from './date-cell';

/** Reading the roster an admin actually has. */

/** A workbook is a ZIP; every .xlsx starts with the local file header "PK". */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export function looksLikeWorkbook(buffer: Buffer): boolean {
  return buffer.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC);
}

/** Whether the bytes are some other binary format wearing a .xlsx name. */
function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 512).includes(0x00);
}

/**
 * Turns an uploaded file into the same table the CSV path produces, so everything downstream —
 * validation, line numbers, the preview — is one code path with one set of rules.
 */
export interface ReadSheetOptions {
  /**
   * The sheet to read when the workbook has several, matched case-insensitively.
   * A generated template carries its own extra tabs — instructions, the lists a
   * dropdown reads — and none of them are rows.
   */
  preferSheet?: string;
}

export async function readUploadedTable(
  buffer: Buffer,
  options: ReadSheetOptions = {},
): Promise<CsvTable> {
  if (buffer.length === 0) {
    throw new AppException(ErrorCodes.VALIDATION_ERROR, 'That file is empty');
  }

  if (!looksLikeWorkbook(buffer)) {
    // Sniffed rather than trusted from the extension: a file renamed to .xlsx
    // is still whatever it was, and the reader's error for one is unreadable.
    if (looksBinary(buffer)) {
      throw new AppException(
        ErrorCodes.VALIDATION_ERROR,
        'That is not a spreadsheet. Save it as .xlsx from Excel and upload that.',
      );
    }
    return readCsvTable(buffer.toString('utf8'));
  }

  return readWorkbookTable(buffer, options);
}

async function readWorkbookTable(buffer: Buffer, options: ReadSheetOptions): Promise<CsvTable> {
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS types this as ArrayBuffer while accepting a Buffer at runtime.
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (cause) {
    throw new AppException(
      ErrorCodes.VALIDATION_ERROR,
      'That file could not be read as a spreadsheet. Save it as .xlsx and try again.',
      { cause },
    );
  }

  // The first sheet unless the caller names one it generated itself. Asking an admin exporting from
  // their own system which sheet to read is a question they cannot answer, and guessing by name
  // would break the moment somebody renamed it.
  const named = options.preferSheet?.toLowerCase();
  const sheet =
    (named
      ? workbook.worksheets.find((worksheet) => worksheet.name.toLowerCase() === named)
      : undefined) ?? workbook.worksheets[0];
  if (!sheet) throw new AppException(ErrorCodes.VALIDATION_ERROR, 'That workbook has no sheets');

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, column) => {
    headers[column - 1] = normaliseHeader(cellText(cell));
  });
  for (let i = 0; i < headers.length; i += 1) headers[i] ??= '';

  const rows: CsvTable['rows'] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const values: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) values[header] = cellText(row.getCell(index + 1)).trim();
    });

    // A row of nothing is what trailing formatting leaves behind; reporting it
    // as an error would mean every real file arrived with errors.
    if (Object.values(values).every((value) => value === '')) return;

    // The sheet's own row number, so an error says the line the admin is
    // looking at in Excel rather than a count of the rows that survived.
    rows.push({ line: rowNumber, values });
  });

  return { headers: headers.filter(Boolean), rows };
}

/** A cell as the admin sees it. */
function cellText(cell: ExcelJS.Cell): string {
  const value: unknown = cell.value;

  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return numberText(value);
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return toIsoDate(value);
  if (typeof value === 'object') return objectCellText(value);

  return scalarText(value);
}

/** The shapes ExcelJS hands back for a cell that is not a plain scalar. */
function objectCellText(value: object): string {
  // Styled text arrives in fragments, one per run of formatting.
  if ('richText' in value && Array.isArray(value.richText)) {
    return value.richText.map((part: { text?: string }) => part.text ?? '').join('');
  }
  if ('text' in value) return scalarText((value as { text: unknown }).text);
  if ('result' in value) {
    // A formula: what the sheet shows is its result, not the formula itself.
    const result: unknown = (value as { result: unknown }).result;
    return typeof result === 'number' ? numberText(result) : scalarText(result);
  }
  if ('hyperlink' in value) return scalarText((value as { hyperlink: unknown }).hyperlink);

  // An ExcelJS shape we do not know. Empty rather than String(value), which yields the literal text
  // "[object Object]" — that then fails validation with a message about the wrong thing entirely.
  return '';
}

/** A value ExcelJS handed back inside a wrapper. */
function scalarText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return numberText(value);
  if (typeof value === 'boolean') return String(value);
  // null, undefined, and any object shape we do not recognise.
  return '';
}

/** No exponent notation, no thousands separator — a mobile number is digits. */
function numberText(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : String(value);
}
