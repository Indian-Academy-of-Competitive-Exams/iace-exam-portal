import {
  DEACTIVATED_MEMBER_MESSAGE,
  GROUP_MEMBER_IMPORT_COLUMNS,
  IMPORT_MAX_ROWS,
  mobileSchema,
  type GroupMemberImportPlan,
  type GroupMemberImportRow,
} from '@iace/contracts';
import { columnValue } from './student-import';
import { type CsvRow, type CsvTable } from './csv';

/** Planning a bulk add into ONE group. */

export interface GroupMemberContext {
  group: { id: string; name: string; branchName: string };
  /** Mobile → the student it resolves to, for the numbers this file lists. */
  studentsByMobile: Map<string, { id: string; fullName: string | null; isActive: boolean }>;
  /** Who is in the group already. */
  memberIds: Set<string>;
}

export function planGroupMemberImport(
  table: CsvTable,
  context: GroupMemberContext,
): GroupMemberImportPlan {
  const empty = { total: 0, willAdd: 0, alreadyMembers: 0, invalid: 0 };

  if (table.headers.length === 0) {
    return { group: context.group, rows: [], summary: empty, fileErrors: ['That file is empty'] };
  }

  const fileErrors = [...missingHeaders(table.headers), ...tooManyRows(table)];
  if (fileErrors.length > 0) {
    return { group: context.group, rows: [], summary: empty, fileErrors };
  }

  // A number listed twice would otherwise be counted as two additions while
  // only ever being one.
  const seenInFile = new Map<string, number>();
  const rows = table.rows.map((row) => planRow(row, context, seenInFile));

  return {
    group: context.group,
    rows,
    summary: {
      total: rows.length,
      willAdd: rows.filter((r) => r.action === 'add').length,
      alreadyMembers: rows.filter((r) => r.action === 'already').length,
      invalid: rows.filter((r) => r.action === 'skip').length,
    },
    fileErrors: [],
  };
}

function missingHeaders(headers: string[]): string[] {
  const missing = GROUP_MEMBER_IMPORT_COLUMNS.filter(
    (column) => !column.aliases.some((alias) => headers.includes(alias)),
  );
  if (missing.length === 0) return [];

  return [
    `The first row must name the column. This file needs "${missing[0]?.header ?? ''}". ` +
      `Download the sample file to see the format.`,
  ];
}

/** The same ceiling as the student import, for one predictable answer. */
function tooManyRows(table: CsvTable): string[] {
  if (table.rows.length <= IMPORT_MAX_ROWS) return [];
  return [
    `That file has ${table.rows.length} rows. Import at most ${IMPORT_MAX_ROWS} at a time — ` +
      `split it and upload the parts.`,
  ];
}

function planRow(
  row: CsvRow,
  context: GroupMemberContext,
  seenInFile: Map<string, number>,
): GroupMemberImportRow {
  const errors: string[] = [];
  const raw = columnValue(row, 'mobile');

  const parsed = mobileSchema.safeParse(raw);
  if (!parsed.success) {
    errors.push(
      raw.trim() === ''
        ? 'No mobile number in this row'
        : (parsed.error.issues[0]?.message ?? 'That is not a valid mobile number'),
    );
    return {
      line: row.line,
      mobile: null,
      studentId: null,
      studentName: null,
      action: 'skip',
      errors,
    };
  }

  const mobile = parsed.data;

  const firstSeen = seenInFile.get(mobile);
  if (firstSeen !== undefined) {
    errors.push(`Same number as line ${firstSeen}`);
  } else {
    seenInFile.set(mobile, row.line);
  }

  const student = context.studentsByMobile.get(mobile);
  if (!student) {
    // Named as a missing STUDENT rather than a bad number, because that is the
    // thing to go and fix — and the fix is the student importer, not this one.
    errors.push('No student has this number yet — import them as a student first');
  }

  // Only when they would be JOINING: a deactivated student already in the group is not
  // being granted anything by this file.
  if (student && !student.isActive && !context.memberIds.has(student.id)) {
    errors.push(DEACTIVATED_MEMBER_MESSAGE);
  }

  if (errors.length > 0 || !student) {
    return {
      line: row.line,
      mobile,
      studentId: student?.id ?? null,
      studentName: student?.fullName ?? null,
      action: 'skip',
      errors,
    };
  }

  return {
    line: row.line,
    mobile,
    studentId: student.id,
    studentName: student.fullName,
    // Already a member is a fine thing to be. Re-uploading last week's list with ten new numbers on
    // the end is how this actually gets used, and calling that an error would bury the ten.
    action: context.memberIds.has(student.id) ? 'already' : 'add',
    errors: [],
  };
}

/** The numbers this file mentions, for one bounded lookup rather than one per row. */
export function mobilesInMemberFile(table: CsvTable): string[] {
  const mobiles = new Set<string>();
  for (const row of table.rows) {
    const parsed = mobileSchema.safeParse(columnValue(row, 'mobile'));
    if (parsed.success) mobiles.add(parsed.data);
  }
  return [...mobiles];
}
