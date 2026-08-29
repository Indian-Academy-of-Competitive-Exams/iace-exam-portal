import {
  EXAM_FAMILIES,
  GENDERS,
  IMPORT_LIST_SEPARATORS,
  IMPORT_MAX_ROWS,
  NO_ACCESS_ROUTE_MESSAGE,
  STUDENT_IMPORT_COLUMNS,
  STUDENT_TYPES,
  canonicalName,
  dobSchema,
  emailSchema,
  mobileSchema,
  personNameSchema,
  type BranchType,
  type ExamFamily,
  type Gender,
  type StudentImportColumn,
  type StudentImportColumnKey,
  type StudentImportProfile,
  type StudentImportRow,
  type StudentImportPlan,
  type StudentType,
} from '@iace/contracts';
import { toIsoDate, type CsvRow, type CsvTable } from '../common/importing';
import { studentBranchBlocker } from '../branches';
import { type BranchScope } from '../common/security';

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
  existingByMobile: Map<
    string,
    { id: string; fullName: string | null; hasPin: boolean; currentBranchId: string | null }
  >;
  /** Canonical branch name → the branch. Active only: a retired one takes no new students. */
  branchByName: Map<string, { id: string; type: BranchType }>;
  /** The branches the admin uploading may write into. Every row is judged against it. */
  scope: BranchScope;
  /** The exam codes an enrolment may name, canonical. */
  examCodes: Set<string>;
  /** The program codes a student may be a candidate for, canonical. */
  programCodes: Set<string>;
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

/** A cell holding several codes, split however it was written and canonicalised. */
function readList(row: CsvRow, key: StudentImportColumnKey): string[] {
  const raw = columnValue(row, key).trim();
  if (raw === '') return [];
  const seen = new Set<string>();
  for (const part of raw.split(IMPORT_LIST_SEPARATORS)) {
    const value = canonicalName(part);
    if (value !== '') seen.add(value);
  }
  return [...seen];
}

/** Every value in the cell that the catalog does not hold. */
function unknownOf(values: string[], known: Set<string>): string[] {
  return values.filter((value) => !known.has(value));
}

/** ONLINE / OFFLINE / NON-IACE, however it was cased or hyphenated. */
function readStudentType(row: CsvRow): { studentType: StudentType | null; error?: string } {
  const raw = columnValue(row, 'studentType').trim();
  if (raw === '') return { studentType: null, error: 'No student type in this row' };

  const wanted = canonicalName(raw).replaceAll(/[\s-]+/g, '_');
  const match = STUDENT_TYPES.find((type) => type === wanted);
  if (match) return { studentType: match };

  return {
    studentType: null,
    error: `"${raw}" is not a student type. Use ${STUDENT_TYPES.join(', ')}.`,
  };
}

/** The branch NAME, resolved against the live list. The sheet never carries an id. */
function readBranch(
  row: CsvRow,
  context: ImportContext,
  studentType: StudentType | null,
): { branchName: string | null; currentBranchId: string | null; error?: string } {
  const raw = columnValue(row, 'branchName').trim();
  if (raw === '')
    return { branchName: null, currentBranchId: null, error: 'No branch in this row' };

  const name = canonicalName(raw);
  const branch = context.branchByName.get(name);
  if (!branch) {
    return {
      branchName: name,
      currentBranchId: null,
      error: `There is no active branch called "${name}".`,
    };
  }

  // The pairing the admin screens refuse; the importer writes rows they never pass through.
  const blocker = studentType ? studentBranchBlocker(studentType, branch.type) : null;
  if (blocker) return { branchName: name, currentBranchId: null, error: blocker };

  if (!context.scope.all && !context.scope.branchIds.includes(branch.id)) {
    return {
      branchName: name,
      currentBranchId: null,
      error: `"${name}" is not one of your branches.`,
    };
  }

  return { branchName: name, currentBranchId: branch.id };
}

/** The families this row names, and the ones that are not families at all. */
function readFamilies(row: CsvRow): { families: ExamFamily[]; error?: string } {
  const values = readList(row, 'enrolledFamilies').map((value) => value.replaceAll(' ', '_'));
  const known = new Set<string>(EXAM_FAMILIES);
  const unknown = unknownOf(values, known);
  if (unknown.length > 0) {
    return { families: [], error: `Not an exam family: ${unknown.join(', ')}.` };
  }
  return { families: values as ExamFamily[] };
}

/** The optional profile columns. A bad value is an error; a blank one is simply absent. */
function readProfile(row: CsvRow): { profile: StudentImportProfile; errors: string[] } {
  const errors: string[] = [];

  const named = (key: StudentImportColumnKey, label: string): string | null => {
    const raw = columnValue(row, key).trim();
    if (raw === '') return null;
    const parsed = personNameSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    errors.push(`${label}: ${parsed.error.issues[0]?.message ?? 'not a valid name'}`);
    return null;
  };

  const rawDob = columnValue(row, 'dob').trim();
  let dob: string | null = null;
  if (rawDob !== '') {
    const iso = toIsoDate(rawDob);
    const parsed = dobSchema.safeParse(iso);
    if (parsed.success) dob = parsed.data;
    // Unchanged means nothing recognised it, and the schema's "use YYYY-MM-DD" would be a lie.
    else if (iso === rawDob) errors.push(`Date of birth: "${rawDob}" is not a date we can read`);
    else errors.push(`Date of birth: ${parsed.error.issues[0]?.message ?? 'not a valid date'}`);
  }

  const rawEmail = columnValue(row, 'email').trim();
  let email: string | null = null;
  if (rawEmail !== '') {
    const parsed = emailSchema.safeParse(rawEmail);
    if (parsed.success) email = parsed.data;
    else errors.push('Email: that is not a valid email address');
  }

  const rawGender = columnValue(row, 'gender').trim();
  let gender: Gender | null = null;
  if (rawGender !== '') {
    const wanted = canonicalName(rawGender);
    const match = GENDERS.find((value) => value === wanted || value.startsWith(wanted));
    if (match) gender = match;
    else errors.push(`Gender: use ${GENDERS.join(', ')}`);
  }

  const address = columnValue(row, 'address').trim();

  return {
    profile: {
      motherName: named('motherName', "Mother's name"),
      fatherName: named('fatherName', "Father's name"),
      dob,
      email,
      gender,
      address: address === '' ? null : address,
    },
    errors,
  };
}

/** One row's plan. */
function planRow(
  row: CsvRow,
  context: ImportContext,
  seenInFile: Map<string, number>,
): StudentImportRow {
  const name = readName(row);
  const number = readMobile(row, seenInFile);
  const type = readStudentType(row);
  const branch = readBranch(row, context, type.studentType);
  const families = readFamilies(row);
  const { profile, errors: profileErrors } = readProfile(row);

  const enrolledExams = readList(row, 'enrolledExams');
  const programs = readList(row, 'programs');
  const unknownExams = unknownOf(enrolledExams, context.examCodes);
  const unknownPrograms = unknownOf(programs, context.programCodes);

  const { fullName } = name;
  const { mobile } = number;

  const existing = mobile ? context.existingByMobile.get(mobile) : undefined;

  const errors = [
    name.error,
    number.error,
    type.error,
    branch.error,
    theirStudent(context.scope, existing),
    families.error,
    unknownExams.length > 0 ? `No such exam code: ${unknownExams.join(', ')}.` : undefined,
    unknownPrograms.length > 0 ? `No such program code: ${unknownPrograms.join(', ')}.` : undefined,
    reachesNothing(families.families, enrolledExams, programs),
    ...profileErrors,
  ].filter((error): error is string => error !== undefined);

  const action = actionFor(errors.length, Boolean(existing));

  return {
    line: row.line,
    mobile,
    fullName,
    studentType: type.studentType,
    branchName: branch.branchName,
    currentBranchId: branch.currentBranchId,
    enrolledFamilies: families.families,
    enrolledExams,
    programs,
    profile,
    existingStudentId: existing?.id ?? null,
    // A student who already chose a PIN keeps it. Re-importing last term's
    // roster must not hand every one of those accounts back to the sheet.
    willReceiveDefaultPin: action !== 'skip' && !existing?.hasPin,
    action,
    errors,
  };
}

/** Family, exam OR program — any one grants access, so none of the three opens nothing. */
function reachesNothing(
  families: ExamFamily[],
  enrolledExams: string[],
  programs: string[],
): string | undefined {
  const routes = [families, enrolledExams, programs];
  return routes.some((route) => route.length > 0) ? undefined : NO_ACCESS_ROUTE_MESSAGE;
}

/** A row naming somebody else's student would MOVE them, so it is refused rather than applied. */
function theirStudent(
  scope: BranchScope,
  existing: { currentBranchId: string | null } | undefined,
): string | undefined {
  if (scope.all || !existing) return undefined;
  // At NO branch is not at another one, and saying so sends the uploader looking for a branch.
  if (existing.currentBranchId === null) {
    return 'That number belongs to a student who is at no branch.';
  }
  return scope.branchIds.includes(existing.currentBranchId)
    ? undefined
    : 'That number belongs to a student at another branch.';
}
