import {
  IMPORT_MAX_ROWS,
  STUDENT_IMPORT_COLUMNS,
  mobileSchema,
  personNameSchema,
  type StudentImportColumn,
  type StudentImportColumnKey,
  type StudentImportRow,
  type StudentImportPlan,
} from '@iace/contracts';
import { type CsvRow, type CsvTable } from '../common/importing';

/** Decides what a roster file WOULD do, without doing any of it. */

/** Finds a column's value however its header was spelled. */
export function columnValue(row: CsvRow, key: StudentImportColumnKey): string {
  const column = STUDENT_IMPORT_COLUMNS.find((candidate) => candidate.key === key);
  for (const alias of column?.aliases ?? []) {
    const value = row.values[alias];
    if (value !== undefined) return value;
  }
  return '';
}

/** Which of the required columns the file does not have, under any of its names. */
function missingColumns(headers: string[]): StudentImportColumn[] {
  return STUDENT_IMPORT_COLUMNS.filter(
    (column) => column.required && !column.aliases.some((alias) => headers.includes(alias)),
  );
}

export interface ImportContext {
  /** Mobile → existing student id, for the whole file's worth of numbers. */
  existingByMobile: Map<string, { id: string; fullName: string | null; hasPin: boolean }>;
}

/**
 * Which mobile numbers a file mentions — what the import loads existing students by, rather than
 * scanning the table once per row.
 */
export function mobilesIn(table: CsvTable): string[] {
  const mobiles = new Set<string>();
  for (const row of table.rows) {
    const parsed = mobileSchema.safeParse(columnValue(row, 'mobile'));
    if (parsed.success) mobiles.add(parsed.data);
  }
  return [...mobiles];
}

export function planStudentImport(table: CsvTable, context: ImportContext): StudentImportPlan {
  if (table.rows.length === 0) {
    return {
      rows: [],
      summary: { total: 0, willCreate: 0, willUpdate: 0, invalid: 0 },
      fileErrors:
        table.headers.length === 0 ? ['That file is empty'] : missingHeaders(table.headers),
    };
  }

  const fileErrors = [...missingHeaders(table.headers), ...tooManyRows(table)];
  if (fileErrors.length > 0) {
    return {
      rows: [],
      summary: { total: 0, willCreate: 0, willUpdate: 0, invalid: 0 },
      fileErrors,
    };
  }

  // A number repeated inside one file would otherwise be counted as two
  // creations and then collide on the unique index at commit time.
  const seenInFile = new Map<string, number>();

  const rows = table.rows.map((row) => planRow(row, context, seenInFile));

  return {
    rows,
    summary: {
      total: rows.length,
      willCreate: rows.filter((r) => r.action === 'create').length,
      willUpdate: rows.filter((r) => r.action === 'update').length,
      invalid: rows.filter((r) => r.action === 'skip').length,
    },
    fileErrors: [],
  };
}

function missingHeaders(headers: string[]): string[] {
  const missing = missingColumns(headers);
  if (missing.length === 0) return [];

  // Named the way the sample file names them, because that is the file the
  // admin is looking at while reading this.
  const wanted = missing.map((column) => `"${column.header}"`).join(', ');
  return [
    `The first row must name the columns. This file needs ${wanted}. ` +
      `Download the sample file to see the format.`,
  ];
}

/** Refused up front rather than part-way through. */
function tooManyRows(table: CsvTable): string[] {
  if (table.rows.length <= IMPORT_MAX_ROWS) return [];
  return [
    `That file has ${table.rows.length} rows. Import at most ${IMPORT_MAX_ROWS} at a time — ` +
      `split it and upload the parts.`,
  ];
}

/** What a row does, in the order the decisions are actually made. */
function actionFor(errorCount: number, exists: boolean): StudentImportRow['action'] {
  if (errorCount > 0) return 'skip';
  return exists ? 'update' : 'create';
}

/** The name column, or the reason it is not usable. */
function readName(row: CsvRow): { fullName: string | null; error?: string } {
  const raw = columnValue(row, 'fullName').trim();
  if (raw === '') return { fullName: null };

  const parsed = personNameSchema.safeParse(raw);
  if (parsed.success) return { fullName: parsed.data };
  return { fullName: null, error: parsed.error.issues[0]?.message ?? 'That name is not valid' };
}

/** The mobile column, or the reason it is not usable. */
function readMobile(
  row: CsvRow,
  seenInFile: Map<string, number>,
): { mobile: string | null; error?: string } {
  const raw = columnValue(row, 'mobile');
  const parsed = mobileSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      mobile: null,
      error:
        raw.trim() === ''
          ? 'No mobile number in this row'
          : (parsed.error.issues[0]?.message ?? 'That is not a valid mobile number'),
    };
  }

  const firstSeen = seenInFile.get(parsed.data);
  if (firstSeen !== undefined) {
    return { mobile: parsed.data, error: `Same number as line ${firstSeen}` };
  }

  seenInFile.set(parsed.data, row.line);
  return { mobile: parsed.data };
}

/** One row's plan. */
function planRow(
  row: CsvRow,
  context: ImportContext,
  seenInFile: Map<string, number>,
): StudentImportRow {
  const name = readName(row);
  const number = readMobile(row, seenInFile);

  const { fullName } = name;
  const { mobile } = number;

  const existing = mobile ? context.existingByMobile.get(mobile) : undefined;

  const errors = [name.error, number.error].filter((error): error is string => error !== undefined);

  const action = actionFor(errors.length, Boolean(existing));

  return {
    line: row.line,
    mobile,
    fullName,
    existingStudentId: existing?.id ?? null,
    // A student who already chose a PIN keeps it. Re-importing last term's
    // roster must not hand every one of those accounts back to the sheet.
    willReceiveDefaultPin: action !== 'skip' && !existing?.hasPin,
    action,
    errors,
  };
}
