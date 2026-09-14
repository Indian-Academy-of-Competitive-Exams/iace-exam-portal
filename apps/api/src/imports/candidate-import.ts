import {
  CANDIDATE_IMPORT_COLUMNS,
  type CandidateImportPlan,
  type CandidateImportRow,
} from '@iace/contracts';
import { type CsvRow, type CsvTable } from '../common/importing';
import { missingColumnErrors, planRoster, readContact } from './student-import';

/** Decides what an event intake WOULD do, without doing any of it. */

const DELETED_MESSAGE =
  'That number belonged to a student who was deleted. Restore them, or enter them on a different number.';

export interface CandidateImportContext {
  /** Mobile → the LIVE student it already belongs to. Such a row only joins the roster. */
  existingByMobile: Map<string, { id: string }>;
  /** Numbers held by a soft-deleted student: unique among live rows only, so a create would succeed. */
  deletedMobiles: Set<string>;
}

export function planCandidateImport(
  table: CsvTable,
  context: CandidateImportContext,
): CandidateImportPlan {
  const { rows, fileErrors } = planRoster(
    table,
    (headers) => missingColumnErrors(CANDIDATE_IMPORT_COLUMNS, headers),
    (row, seenInFile) => planRow(row, context, seenInFile),
  );

  return {
    rows,
    summary: {
      total: rows.length,
      willCreate: rows.filter((row) => row.action === 'create').length,
      willAdd: rows.filter((row) => row.action === 'add').length,
      invalid: rows.filter((row) => row.action === 'skip').length,
    },
    fileErrors,
  };
}

/** A row we cannot enter is skipped; past that, knowing the number is the whole of the decision. */
function actionFor(hasErrors: boolean, isExisting: boolean): CandidateImportRow['action'] {
  if (hasErrors) return 'skip';
  return isExisting ? 'add' : 'create';
}

function planRow(
  row: CsvRow,
  context: CandidateImportContext,
  seenInFile: Map<string, number>,
): CandidateImportRow {
  const { mobile, fullName, errors: contactErrors } = readContact(row, seenInFile);
  const existing = mobile === null ? undefined : context.existingByMobile.get(mobile);
  const errors =
    mobile !== null && context.deletedMobiles.has(mobile)
      ? [...contactErrors, DELETED_MESSAGE]
      : contactErrors;

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
