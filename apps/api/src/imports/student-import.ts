import {
  IMPORT_MAX_ROWS,
  STUDENT_IMPORT_COLUMNS,
  canonicalName,
  mobileSchema,
  personNameSchema,
  type StudentImportColumn,
  type StudentImportColumnKey,
  type StudentImportRow,
  type StudentImportPlan,
} from '@iace/contracts';
import { type CsvRow, type CsvTable } from './csv';

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

/**
 * Finds a column's value however its header was spelled.
 *
 * The sheet says "Mobile Number"; a roster exported from somewhere else says
 * "Phone"; last month's template said "mobile". All three mean the same column,
 * and every one of them is a file an admin will actually try to import.
 */
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

/** Several groups in one cell, because a comma is already the column separator. */
const GROUP_SEPARATOR = /[;|]/;

/** How a cell names the branch a group is in: "AMEERPET / SSC CGL MORNING". */
const BRANCH_QUALIFIER = '/';

export interface ImportGroup {
  id: string;
  name: string;
  branchName: string;
}

export interface ImportContext {
  /** Mobile → existing student id, for the whole file's worth of numbers. */
  existingByMobile: Map<string, { id: string; fullName: string | null; hasPin: boolean }>;
  /**
   * Canonical group name → every group with that name, one per branch.
   *
   * A list rather than a single group, because a name is only unique WITHIN a
   * branch. An unqualified name that matches two of them is a question, not a
   * guess — see `resolveGroup`.
   */
  groupsByName: Map<string, ImportGroup[]>;
}

/**
 * Turns one cell entry into a group, or into the reason it could not be one.
 *
 * Groups are never created implicitly: a typo would otherwise become a real
 * group that grants access to nothing and that nobody notices. And an
 * ambiguous name is never resolved by picking the first — that would put a
 * student in the wrong centre's batch, which reads as success everywhere.
 */
export function resolveGroup(
  entry: string,
  groupsByName: Map<string, ImportGroup[]>,
): { group: ImportGroup } | { error: string } {
  const separator = entry.indexOf(BRANCH_QUALIFIER);
  const branchName = separator === -1 ? null : canonicalName(entry.slice(0, separator));
  const name = canonicalName(separator === -1 ? entry : entry.slice(separator + 1));

  const matches = groupsByName.get(name) ?? [];

  if (branchName !== null) {
    const match = matches.find((group) => group.branchName === branchName);
    return match
      ? { group: match }
      : { error: `No group called "${name}" in branch "${branchName}"` };
  }

  if (matches.length === 0) return { error: `No group called "${name}"` };
  if (matches.length === 1) return { group: matches[0]! };

  const branches = matches.map((group) => group.branchName).join(', ');
  return {
    error: `"${name}" exists in more than one branch (${branches}) — write it as "${matches[0]!.branchName} ${BRANCH_QUALIFIER} ${name}"`,
  };
}

/**
 * Which mobile numbers a file mentions — what the import loads existing
 * students by, rather than scanning the table once per row.
 *
 * Pure and exported so it is TESTED. It once read `row.values.mobile` while the
 * sheet's header said "Mobile Number", so it matched nothing: every row in a
 * re-import looked new, and the commit collided on the unique mobile instead of
 * updating the student who already had it. Nothing about the preview looked
 * wrong — it said "create" in confident green.
 */
export function mobilesIn(table: CsvTable): string[] {
  const mobiles = new Set<string>();
  for (const row of table.rows) {
    const parsed = mobileSchema.safeParse(columnValue(row, 'mobile'));
    if (parsed.success) mobiles.add(parsed.data);
  }
  return [...mobiles];
}

/** Every group entry the file names, still unresolved. Same reasoning. */
export function groupEntriesIn(table: CsvTable): string[] {
  const entries = new Set<string>();
  for (const row of table.rows) {
    for (const entry of columnValue(row, 'groups').split(GROUP_SEPARATOR)) {
      if (entry.trim()) entries.add(entry);
    }
  }
  return [...entries];
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

/**
 * Refused up front rather than part-way through. See IMPORT_MAX_ROWS: the cost
 * is the per-student PIN hash, and a file this size would time out mid-write
 * leaving the admin unable to tell what had applied.
 */
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

/**
 * The name column, or the reason it is not usable.
 *
 * A blank name is absent, not invalid — plenty of rosters have numbers before
 * they have names. "Kumari, Asha" is a spreadsheet artefact, and letting it
 * through means it greets the student that way forever.
 */
function readName(row: CsvRow): { fullName: string | null; error?: string } {
  const raw = columnValue(row, 'fullName').trim();
  if (raw === '') return { fullName: null };

  const parsed = personNameSchema.safeParse(raw);
  if (parsed.success) return { fullName: parsed.data };
  return { fullName: null, error: parsed.error.issues[0]?.message ?? 'That name is not valid' };
}

/**
 * The mobile column, or the reason it is not usable.
 *
 * Also records the number against its line, so the SECOND appearance of a
 * number in one file is reported rather than counted as another student.
 */
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

/** Every group the cell names, resolved — or the reasons they could not be. */
function readGroups(
  row: CsvRow,
  groupsByName: ImportContext['groupsByName'],
): { groupNames: string[]; groupIds: string[]; errors: string[] } {
  const groupNames = columnValue(row, 'groups')
    .split(GROUP_SEPARATOR)
    .map((name) => name.trim())
    .filter(Boolean);

  const groupIds: string[] = [];
  const errors: string[] = [];

  for (const entry of groupNames) {
    const resolved = resolveGroup(entry, groupsByName);
    if ('error' in resolved) errors.push(resolved.error);
    else groupIds.push(resolved.group.id);
  }

  return { groupNames, groupIds, errors };
}

/**
 * One row's plan.
 *
 * Each column is read by its own function above. They were inline, and between
 * them made a function nobody could check against the rules it was supposed to
 * be applying — which for the thing that decides who gets enrolled is the wrong
 * place to save a few lines.
 */
function planRow(
  row: CsvRow,
  context: ImportContext,
  seenInFile: Map<string, number>,
): StudentImportRow {
  const name = readName(row);
  const number = readMobile(row, seenInFile);
  const groups = readGroups(row, context.groupsByName);

  const errors = [name.error, number.error, ...groups.errors].filter(
    (error): error is string => error !== undefined,
  );

  const { fullName } = name;
  const { mobile } = number;
  const { groupNames, groupIds } = groups;

  const existing = mobile ? context.existingByMobile.get(mobile) : undefined;
  const action = actionFor(errors.length, Boolean(existing));

  return {
    line: row.line,
    mobile,
    fullName,
    groupNames,
    groupIds,
    existingStudentId: existing?.id ?? null,
    // A student who already chose a PIN keeps it. Re-importing last term's
    // roster must not hand every one of those accounts back to the sheet.
    willReceiveDefaultPin: action !== 'skip' && !existing?.hasPin,
    action,
    errors,
  };
}
