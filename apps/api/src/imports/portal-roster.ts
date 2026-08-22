import { STUDENT_IMPORT_COLUMNS, type StudentImportColumnKey } from '@iace/contracts';
import { normaliseHeader, type CsvRow, type CsvTable } from '../common/importing';

/** Said back to the admin when the portal cannot be reached, so it reads as a source problem. */
export const PORTAL_NOT_CONFIGURED =
  'The main portal is not connected yet, so there is nothing to sync. Nothing was changed.';

/** One student as the portal states them, before anything here has judged the values. */
export type PortalStudent = Partial<Record<StudentImportColumnKey, string>>;

export interface PortalFetch {
  /** The roster in the shape the sheet parser produces, so one planner validates both. */
  table: CsvTable;
  /** Verbatim, so a disagreement is settled against what the portal actually sent. */
  payload: Buffer;
  /** Wrong with the FETCH rather than any row — unreachable, unauthorised, malformed. */
  errors: string[];
}

/** Normalised, because that is what readCsvTable produces and what `columnValue` matches on. */
const HEADERS = STUDENT_IMPORT_COLUMNS.map((column) => normaliseHeader(column.header));

/** Line 1 is the header even when nobody typed one, because every row error counts from there. */
function rowsOf(students: readonly PortalStudent[]): CsvRow[] {
  return students.map((student, index) => ({
    line: index + 2,
    values: Object.fromEntries(
      STUDENT_IMPORT_COLUMNS.map((column) => [
        normaliseHeader(column.header),
        student[column.key as StudentImportColumnKey] ?? '',
      ]),
    ),
  }));
}

/** The portal's rows as a table, so `planStudentImport` needs to know nothing about where they came from. */
export function portalTable(students: readonly PortalStudent[]): CsvTable {
  return { headers: [...HEADERS], rows: rowsOf(students) };
}

/** The ONE unfinished piece: connecting the portal is this function and nothing else. */
export async function fetchPortalRoster(): Promise<PortalFetch> {
  return {
    table: portalTable([]),
    payload: Buffer.from(JSON.stringify({ error: PORTAL_NOT_CONFIGURED }), 'utf8'),
    errors: [PORTAL_NOT_CONFIGURED],
  };
}
