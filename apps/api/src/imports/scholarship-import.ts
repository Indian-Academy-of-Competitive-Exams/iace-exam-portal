import {
  IMPORT_MAX_ROWS,
  SCHOLARSHIP_IMPORT_COLUMNS,
  mobileSchema,
  type ScholarshipImportPlan,
  type ScholarshipImportRow,
} from '@iace/contracts';
import { type CsvRow, type CsvTable } from '../common/importing';
import { columnValue } from './student-import';

/** Decides what a scholarship intake WOULD do, without doing any of it. */

/** The sheet is an enrolment list from outside: a number and a name, and nothing to overwrite with. */
const REQUIRED_COLUMN = 'mobile';

const DELETED_MESSAGE =
  'That number belonged to a student who was deleted. Restore them, or enrol them on a different number.';

export interface ScholarshipImportContext {
  /** Mobile → the LIVE student it already belongs to. Such a row grants and writes nothing else. */
  existingByMobile: Map<string, { id: string; hasPin: boolean }>;
  /** Numbers held by a soft-deleted student: unique among live rows only, so a create would succeed. */
  deletedMobiles: Set<string>;
}

function missingHeaders(headers: string[]): string[] {
  return SCHOLARSHIP_IMPORT_COLUMNS.filter(
    (column) => column.required && !column.aliases.some((alias) => headers.includes(alias)),
  ).map((column) => `That file has no ${column.header} column`);
}

function tooManyRows(table: CsvTable): string[] {
  return table.rows.length > IMPORT_MAX_ROWS
    ? [`That file has ${table.rows.length} rows. Split it into files of ${IMPORT_MAX_ROWS}.`]
    : [];
}

const EMPTY = { total: 0, willCreate: 0, willGrant: 0, invalid: 0 };

export function planScholarshipImport(
  table: CsvTable,
  context: ScholarshipImportContext,
): ScholarshipImportPlan {
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

  // A number repeated in one file would be two creations, then a collision on the unique index.
  const seenInFile = new Map<string, number>();
  const rows = table.rows.map((row) => planRow(row, context, seenInFile));

  return {
    rows,
    summary: {
      total: rows.length,
      willCreate: rows.filter((row) => row.action === 'create').length,
      willGrant: rows.filter((row) => row.action === 'grant').length,
      invalid: rows.filter((row) => row.action === 'skip').length,
    },
    fileErrors: [],
  };
}

/** A row we cannot enrol is skipped; past that, knowing the number is the whole of the decision. */
function actionFor(hasErrors: boolean, isExisting: boolean): ScholarshipImportRow['action'] {
  if (hasErrors) return 'skip';
  return isExisting ? 'grant' : 'create';
}

function planRow(
  row: CsvRow,
  context: ScholarshipImportContext,
  seenInFile: Map<string, number>,
): ScholarshipImportRow {
  const parsed = mobileSchema.safeParse(columnValue(row, REQUIRED_COLUMN));
  const mobile = parsed.success ? parsed.data : null;
  const fullName = columnValue(row, 'fullName').trim() || null;

  const duplicateOf = mobile === null ? undefined : seenInFile.get(mobile);
  if (mobile !== null && duplicateOf === undefined) seenInFile.set(mobile, row.line);

  const existing = mobile === null ? undefined : context.existingByMobile.get(mobile);
  const errors = [
    parsed.success ? undefined : 'That is not a mobile number we can enrol on',
    duplicateOf === undefined ? undefined : `The same number is already on line ${duplicateOf}`,
    mobile !== null && context.deletedMobiles.has(mobile) ? DELETED_MESSAGE : undefined,
  ].filter((error): error is string => error !== undefined);

  const action = actionFor(errors.length > 0, existing !== undefined);

  return {
    line: row.line,
    mobile,
    fullName,
    existingStudentId: existing?.id ?? null,
    // A student who already chose a PIN keeps it; a new candidate is handed one.
    willReceiveDefaultPin: action === 'create',
    action,
    errors,
  };
}
