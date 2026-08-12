import { mobileSchema, type StudentImportRow, type StudentImportPlan } from '@iace/contracts';
import { readCsvTable, type CsvRow } from './csv';

/**
 * Decides what a roster file WOULD do, without doing any of it.
 *
 * Pure on purpose: preview and commit must agree exactly, and the only way to
 * guarantee that is for both to run this same function over the same input.
 * A preview that says "42 will be created" and a commit that creates 41 is
 * worse than no preview at all.
 *
 * Forgiving, per the importer rule: a bad row is reported against its line
 * number and the rest of the file still goes in.
 */

/** What the sheet must contain, and what it may. */
export const REQUIRED_HEADERS = ['mobile'] as const;
export const OPTIONAL_HEADERS = ['fullname', 'groups'] as const;

/** Several groups in one cell, because a comma is already the column separator. */
const GROUP_SEPARATOR = /[;|]/;

export interface ImportContext {
  /** Mobile → existing student id, for the whole file's worth of numbers. */
  existingByMobile: Map<string, { id: string; fullName: string | null }>;
  /** Lowercased group name → id. */
  groupsByName: Map<string, { id: string; name: string }>;
}

export function planStudentImport(csv: string, context: ImportContext): StudentImportPlan {
  const table = readCsvTable(csv);

  if (table.rows.length === 0) {
    return {
      rows: [],
      summary: { total: 0, willCreate: 0, willUpdate: 0, invalid: 0 },
      fileErrors:
        table.headers.length === 0 ? ['That file is empty'] : missingHeaders(table.headers),
    };
  }

  const fileErrors = missingHeaders(table.headers);
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
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  return missing.length === 0
    ? []
    : [
        `The file needs a "${missing.join('", "')}" column. Found: ${headers.join(', ') || 'nothing'}`,
      ];
}

function planRow(
  row: CsvRow,
  context: ImportContext,
  seenInFile: Map<string, number>,
): StudentImportRow {
  const errors: string[] = [];
  const rawMobile = row.values.mobile ?? '';
  const fullName = row.values.fullname?.trim() || null;

  const parsedMobile = mobileSchema.safeParse(rawMobile);
  const mobile = parsedMobile.success ? parsedMobile.data : null;

  if (!parsedMobile.success) {
    errors.push(
      rawMobile.trim() === ''
        ? 'No mobile number in this row'
        : (parsedMobile.error.issues[0]?.message ?? 'That is not a valid mobile number'),
    );
  } else {
    const firstSeen = seenInFile.get(parsedMobile.data);
    if (firstSeen !== undefined) {
      errors.push(`Same number as line ${firstSeen}`);
    } else {
      seenInFile.set(parsedMobile.data, row.line);
    }
  }

  const groupNames = (row.values.groups ?? '')
    .split(GROUP_SEPARATOR)
    .map((name) => name.trim())
    .filter(Boolean);

  const groupIds: string[] = [];
  for (const name of groupNames) {
    const group = context.groupsByName.get(name.toLowerCase());
    // Groups are never created implicitly: a typo would otherwise silently
    // become a real group that grants nothing and nobody notices.
    if (!group) errors.push(`No group called "${name}"`);
    else groupIds.push(group.id);
  }

  const existing = mobile ? context.existingByMobile.get(mobile) : undefined;

  return {
    line: row.line,
    mobile,
    fullName,
    groupNames,
    groupIds,
    existingStudentId: existing?.id ?? null,
    action: errors.length > 0 ? 'skip' : existing ? 'update' : 'create',
    errors,
  };
}
