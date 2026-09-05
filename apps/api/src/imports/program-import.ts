import {
  IMPORT_MAX_ROWS,
  PROGRAM_IMPORT_COLUMNS,
  mobileSchema,
  type ProgramImportPlan,
  type ProgramImportRow,
} from '@iace/contracts';
import { type CsvRow, type CsvTable } from '../common/importing';
import { columnValue } from './student-import';

/** Decides what a program enrolment WOULD do, without doing any of it. */

const REQUIRED_COLUMN = 'mobile';

const UNKNOWN_MESSAGE =
  'No student on that number. A program is something an enrolled student carries, so add them first.';

export interface ProgramImportContext {
  /** Mobile → the LIVE student it belongs to, and what they already carry. */
  studentsByMobile: Map<string, { id: string; fullName: string | null; programs: string[] }>;
  /** The program being filled, by the code a student carries. */
  programCode: string;
}

function missingHeaders(headers: string[]): string[] {
  return PROGRAM_IMPORT_COLUMNS.filter(
    (column) => column.required && !column.aliases.some((alias) => headers.includes(alias)),
  ).map((column) => `That file has no ${column.header} column`);
}

function tooManyRows(table: CsvTable): string[] {
  return table.rows.length > IMPORT_MAX_ROWS
    ? [`That file has ${table.rows.length} rows. Split it into files of ${IMPORT_MAX_ROWS}.`]
    : [];
}

const EMPTY = { total: 0, willEnrol: 0, alreadyEnrolled: 0, invalid: 0 };

export function planProgramImport(
  table: CsvTable,
  context: ProgramImportContext,
): ProgramImportPlan {
  if (table.rows.length === 0) {
    return {
      rows: [],
      summary: EMPTY,
      fileErrors:
        table.headers.length === 0 ? ['That file is empty'] : missingHeaders(table.headers),
    };
  }

  const fileErrors = [...missingHeaders(table.headers), ...tooManyRows(table)];
  if (fileErrors.length > 0) return { rows: [], summary: EMPTY, fileErrors };

  const seenInFile = new Map<string, number>();
  const rows = table.rows.map((row) => planRow(row, context, seenInFile));

  return {
    rows,
    summary: {
      total: rows.length,
      willEnrol: rows.filter((row) => row.action === 'enrol').length,
      alreadyEnrolled: rows.filter((row) => row.action === 'already').length,
      invalid: rows.filter((row) => row.action === 'skip').length,
    },
    fileErrors: [],
  };
}

function planRow(
  row: CsvRow,
  context: ProgramImportContext,
  seenInFile: Map<string, number>,
): ProgramImportRow {
  const parsed = mobileSchema.safeParse(columnValue(row, REQUIRED_COLUMN));
  const mobile = parsed.success ? parsed.data : null;
  const fullName = columnValue(row, 'fullName').trim() || null;

  const duplicateOf = mobile === null ? undefined : seenInFile.get(mobile);
  if (mobile !== null && duplicateOf === undefined) seenInFile.set(mobile, row.line);

  const student = mobile === null ? undefined : context.studentsByMobile.get(mobile);

  const errors = [
    parsed.success ? undefined : 'That is not a mobile number we can enter',
    duplicateOf === undefined ? undefined : `The same number is already on line ${duplicateOf}`,
    // The whole of the rule: this import ENROLS, it never creates.
    mobile !== null && duplicateOf === undefined && student === undefined
      ? UNKNOWN_MESSAGE
      : undefined,
  ].filter((error): error is string => error !== undefined);

  return {
    line: row.line,
    mobile,
    fullName,
    studentId: student?.id ?? null,
    studentName: student?.fullName ?? null,
    action: actionFor(errors.length > 0, student?.programs.includes(context.programCode) ?? false),
    errors,
  };
}

/** A student already carrying it is not an error: re-uploading last term's list is normal. */
function actionFor(hasErrors: boolean, carriesIt: boolean): ProgramImportRow['action'] {
  if (hasErrors) return 'skip';
  return carriesIt ? 'already' : 'enrol';
}
