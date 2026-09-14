import {
  PROGRAM_IMPORT_COLUMNS,
  type ProgramImportPlan,
  type ProgramImportRow,
} from '@iace/contracts';
import { type CsvRow, type CsvTable } from '../common/importing';
import { missingColumnErrors, planRoster, readContact } from './student-import';

/** Decides what a program enrolment WOULD do, without doing any of it. */

const UNKNOWN_MESSAGE =
  'No student on that number. A program is something an enrolled student carries, so add them first.';

export interface ProgramImportContext {
  /** Mobile → the LIVE student it belongs to, and what they already carry. */
  studentsByMobile: Map<string, { id: string; fullName: string | null; programs: string[] }>;
  /** The program being filled, by the code a student carries. */
  programCode: string;
}

export function planProgramImport(
  table: CsvTable,
  context: ProgramImportContext,
): ProgramImportPlan {
  const { rows, fileErrors } = planRoster(
    table,
    (headers) => missingColumnErrors(PROGRAM_IMPORT_COLUMNS, headers),
    (row, seenInFile) => planRow(row, context, seenInFile),
  );

  return {
    rows,
    summary: {
      total: rows.length,
      willEnrol: rows.filter((row) => row.action === 'enrol').length,
      alreadyEnrolled: rows.filter((row) => row.action === 'already').length,
      invalid: rows.filter((row) => row.action === 'skip').length,
    },
    fileErrors,
  };
}

function planRow(
  row: CsvRow,
  context: ProgramImportContext,
  seenInFile: Map<string, number>,
): ProgramImportRow {
  const { mobile, fullName, duplicateOf, errors: contactErrors } = readContact(row, seenInFile);
  const student = mobile === null ? undefined : context.studentsByMobile.get(mobile);
  // The whole of the rule: this import ENROLS, it never creates.
  const unknown = mobile !== null && duplicateOf === undefined && student === undefined;
  const errors = unknown ? [...contactErrors, UNKNOWN_MESSAGE] : contactErrors;

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
