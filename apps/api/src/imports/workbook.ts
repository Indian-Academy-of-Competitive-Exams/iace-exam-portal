import ExcelJS from 'exceljs';
import {
  AppException,
  ErrorCodes,
  GROUP_MEMBER_IMPORT_COLUMNS,
  STUDENT_IMPORT_COLUMNS,
} from '@iace/contracts';
import { normaliseHeader, readCsvTable, type CsvTable } from './csv';

/**
 * Reading the roster an admin actually has.
 *
 * They keep it in Excel, so that is what the importer takes. A .csv is still
 * accepted without saying so loudly: it is what other systems export, it opens
 * in Excel anyway, and refusing one would be a rule with no purpose behind it.
 */

/** A workbook is a ZIP; every .xlsx starts with the local file header "PK". */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export function looksLikeWorkbook(buffer: Buffer): boolean {
  return buffer.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC);
}

/**
 * Whether the bytes are some other binary format wearing a .xlsx name.
 *
 * Without this, a JPEG reaches the CSV reader and comes back as
 * `The file needs a "mobile" column. Found: ����notanexcel` — a message that
 * describes the wrong problem in unreadable characters. A NUL byte does not
 * occur in the text files this importer is meant to take.
 */
function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 512).includes(0x00);
}

/**
 * Turns an uploaded file into the same table the CSV path produces, so
 * everything downstream — validation, line numbers, the preview — is one code
 * path with one set of rules.
 */
export async function readUploadedTable(buffer: Buffer): Promise<CsvTable> {
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

  return readWorkbookTable(buffer);
}

async function readWorkbookTable(buffer: Buffer): Promise<CsvTable> {
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

  // The first sheet, always. Asking which one is a question an admin exporting
  // from their own system cannot answer, and guessing by name would break the
  // moment somebody renamed it.
  const sheet = workbook.worksheets[0];
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

/**
 * A cell as the admin sees it.
 *
 * The awkward ones are all mobile numbers: Excel stores a bare 9876543210 as a
 * number, and `String(value)` on a large one yields "9.87654e+9". Formulas come
 * back as an object holding their result, and a cell someone styled arrives as
 * rich text in fragments.
 */
function cellText(cell: ExcelJS.Cell): string {
  const value: unknown = cell.value;

  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return numberText(value);
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part: { text?: string }) => part.text ?? '').join('');
    }
    if ('text' in value) return String((value as { text: unknown }).text ?? '');
    if ('result' in value) {
      const result: unknown = (value as { result: unknown }).result;
      return typeof result === 'number' ? numberText(result) : String(result ?? '');
    }
    if ('hyperlink' in value) return String((value as { hyperlink: unknown }).hyperlink ?? '');
  }

  return String(value);
}

/** No exponent notation, no thousands separator — a mobile number is digits. */
function numberText(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : String(value);
}

/**
 * The sample file the UI offers.
 *
 * Built from the same column list the parser matches on, so it cannot document
 * a format the importer does not accept — a hand-maintained sample drifts the
 * first time a column is renamed, and takes every admin who downloaded it with
 * it.
 */
export function buildStudentTemplate(): Promise<Buffer> {
  return buildTemplate({
    sheetName: 'Students',
    columns: STUDENT_IMPORT_COLUMNS,
    examples: STUDENT_IMPORT_EXAMPLES,
    notes: STUDENT_IMPORT_NOTES,
  });
}

/** The membership sheet: one column, because the group is not in the file. */
export function buildGroupMemberTemplate(): Promise<Buffer> {
  return buildTemplate({
    sheetName: 'Members',
    columns: GROUP_MEMBER_IMPORT_COLUMNS,
    examples: [['9876543210'], ['9876543211'], ['9876543212']],
    notes: GROUP_MEMBER_IMPORT_NOTES,
  });
}

async function buildTemplate(options: {
  sheetName: string;
  columns: readonly { key: string; header: string; width: number }[];
  examples: unknown[][];
  notes: string[][];
}): Promise<Buffer> {
  const { sheetName, columns, examples, notes: noteLines } = options;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'IACE';
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  });

  for (const example of examples) sheet.addRow(example);

  // Mobile numbers are text, not numbers: left as numeric, Excel drops a
  // leading zero and shows long ones in exponent form, and the file that comes
  // back is full of "9.87654E+09".
  sheet.getColumn(1).numFmt = '@';

  const notes = workbook.addWorksheet('How to use');
  notes.getColumn(1).width = 100;
  for (const line of noteLines) notes.addRow(line);
  notes.getRow(1).font = { bold: true };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const STUDENT_IMPORT_EXAMPLES = [
  ['9876543210', 'Asha Kumari', 'SSC CGL MORNING'],
  ['9876543211', 'Ravi Teja', 'AMEERPET / SSC CGL MORNING;GLOBAL / ALL STUDENTS'],
  ['9876543212', '', ''],
];

const STUDENT_IMPORT_NOTES = [
  ['How to fill this in'],
  [''],
  ['Mobile Number — required. 10 digits. This is what identifies a student: if the'],
  ['number already exists, that student is updated rather than duplicated.'],
  [''],
  ['Each new student is given a starting PIN: the FIRST FOUR DIGITS of their own'],
  ['mobile number. Tell them to change it when they first sign in — anyone holding'],
  ['this sheet can work it out. A student who has already chosen a PIN keeps it.'],
  [''],
  ['Full Name — optional. Letters, spaces and . ’ - only. Leave it blank if you'],
  ['do not know it yet; it can be filled in later.'],
  [''],
  ['Groups — optional. Separate several with a semicolon (;).'],
  ['A group name is unique only WITHIN its branch, so if two branches run the same'],
  ['batch, write the branch too: AMEERPET / SSC CGL MORNING'],
  ['Groups are never created by an import — a name that matches nothing is reported.'],
  [''],
  ['Nothing is written until you press Import. The preview shows exactly what would'],
  ['happen to every row, and rows with errors are skipped rather than stopping the file.'],
];

const GROUP_MEMBER_IMPORT_NOTES = [
  ['How to fill this in'],
  [''],
  ['One column: the mobile number of each student to add to this group.'],
  ['The group is the one you are on in the admin — it is not written in the file,'],
  ['so a sheet cannot put students into a batch nobody checked.'],
  [''],
  ['A number that already belongs to this group is left alone rather than reported'],
  ['as a problem: re-uploading last week’s list with ten new numbers on the end is'],
  ['the normal way to use this.'],
  [''],
  ['A number that belongs to NO student is reported. Nobody is enrolled from this'],
  ['sheet — import them on the Students screen first, then add them here.'],
  [''],
  ['Removing someone is done on the student, one at a time. It takes away their'],
  ['route to a test, which is not something a spreadsheet should do quietly.'],
];
