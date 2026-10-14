import {
  previewTextOf,
  QUESTION_IMPORT_COLUMNS,
  QUESTION_IMPORT_MAX_ROWS,
  QUESTION_IMPORT_SECTION_COLUMN,
  SECTION_IMPORT_MAX_ROWS,
  fileDuplicateOf,
  QUESTION_IMPORT_TAG,
  leadLanguageIn,
  QUESTION_VALIDATION_CODE,
  TAGS_MAX,
  type ImportWarning,
  type QuestionDraft,
  type QuestionImportAction,
  type QuestionImportPlan,
  type QuestionImportRow,
  type ValidationIssue,
  SECTION_QUESTION_TYPES,
  type SectionAnswerKind,
} from '@iace/contracts';
import { type CsvRow, type CsvTable, normaliseHeader } from '../common/importing';
import type { CheckedImage } from './question-images';
import { computeStemHash, languagesIn, validateQuestion } from './question-core';
import { lookupName, type TaxonomyCatalog } from './taxonomy-context';
import {
  blank,
  cellOf,
  READ_COLUMNS,
  rowContent,
  buildDraft,
  readType,
  readCode,
  warnOfInlinePassage,
  TOO_MANY_TAGS,
  type RowContent,
} from './question-import-cells';
import { causesOf, missingOf, type MissingValue } from './question-import-causes';

/** A sheet of questions, judged row by row: nothing here writes, the preview an admin reads and the commit that follows are the same function, and every row is turned into the SAME `QuestionDraft` the single-question form posts and handed to the SAME `validateQuestion` — a cell the sheet alone can get wrong (an unreadable number, a subject that is not in the bank) is reported here, everything about what makes a question valid lives in the core. */

const CODE = QUESTION_VALIDATION_CODE;

/** What the bank already holds, so a repeat is recognised without a query per row. */
export interface ImportDedupContext {
  /** stemHash -> the id of the question that already has it. */
  questionIdByHash: Map<string, string>;
  /** questionCode -> the question holding it, so a sheet cannot claim one twice. */
  questionIdByCode: Map<string, string>;
}

export interface PlannedRow extends QuestionImportRow {
  /** Only for a row that will be created. Never sent to the client. */
  draft: QuestionDraft | null;
  stemHash: string | null;
  /** As the schema parsed it, which is what the bank would be asked about. */
  questionCode: string | null;
  /** By storage key: what a commit uploads before it writes the question that shows them. */
  pictures: Map<string, CheckedImage>;
  /** The question this row reads as, whatever its action: what the review window opens. */
  editable: QuestionDraft;
  /** A whole-test row's typist, whose draft it becomes; null everywhere else. */
  assignmentId: string | null;
  /** The sheet value the bank does not hold, when that is what keeps the row out. */
  missing: MissingValue | null;
}

/** The one section a sheet is imported into, and the subject it takes. */
export interface ImportScope {
  sectionName: string;
  subject: { id: string; name: string } | null;
  /** How the section is answered, which names the one kind of question it takes. */
  kind: SectionAnswerKind;
}

/** One section of a whole typed test, as a row naming it is judged. */
export interface TestImportSection extends ImportScope {
  id: string;
  /** How many more drafts its typist can take: its count less those they hold. */
  room: number;
  /** Why it takes no rows — no typist, or theirs is done — or null when it does. */
  closed: string | null;
  /** The typist whose drafts its rows become. */
  assignmentId: string | null;
}

/** A whole typed test: each row goes to the section its Section cell names, by name however typed. */
export interface TestImportScope {
  sections: ReadonlyMap<string, TestImportSection>;
}

type SheetScope = ImportScope | TestImportScope;

const isTestScope = (scope: SheetScope | null): scope is TestImportScope =>
  scope !== null && 'sections' in scope;

/** No row corrected yet: the sheet speaks for every line. */
const NO_EDITS: ReadonlyMap<number, QuestionDraft> = new Map();

const NO_LINES: ReadonlySet<number> = new Set();

/** A first pass has nothing to compare against: it runs to harvest the keys the bank is asked for. */
export const NO_DEDUP: ImportDedupContext = {
  questionIdByHash: new Map(),
  questionIdByCode: new Map(),
};

export interface QuestionImportPlanning extends Omit<QuestionImportPlan, 'importLogId'> {
  rows: PlannedRow[];
}

export function planQuestionImport(
  table: CsvTable,
  catalog: TaxonomyCatalog,
  dedup: ImportDedupContext,
  edits: ReadonlyMap<number, QuestionDraft> = NO_EDITS,
  leftOut: ReadonlySet<number> = NO_LINES,
  scope: SheetScope | null = null,
): QuestionImportPlanning {
  const fileErrors = fileLevelErrors(table, scope);
  if (fileErrors.length > 0) {
    return {
      rows: [],
      summary: { total: 0, willCreate: 0, duplicates: 0, invalid: 0, leftOut: 0 },
      fileErrors,
    };
  }

  // Two rows of the same question in one file is the commonest sheet mistake, and the second one has to be reported against the line that repeats it.
  const lineByHash = new Map<string, number>();
  const codesInFile = new Set<string>();

  const taken = new Map<string, number>();

  const rows = table.rows.map((row) =>
    planRow(row, catalog, dedup, lineByHash, codesInFile, {
      edit: edits.get(row.line),
      leftOut: leftOut.has(row.line),
      ...(isTestScope(scope) ? placeRow(row, scope, taken) : { scope }),
    }),
  );

  return {
    rows,
    causes: causesOf(rows, catalog),
    summary: {
      total: rows.length,
      willCreate: rows.filter((row) => row.action === 'create').length,
      duplicates: rows.filter((row) => row.action === 'duplicate').length,
      invalid: rows.filter((row) => row.action === 'skip').length,
      leftOut: rows.filter((row) => row.action === 'left_out').length,
    },
    fileErrors: [],
  };
}

function fileLevelErrors(table: CsvTable, scope: SheetScope | null): string[] {
  const errors: string[] = [];

  if (table.rows.length === 0) {
    errors.push('That file has no question rows');
    return errors;
  }

  const most = mostRowsFor(scope);
  if (table.rows.length > most) {
    const where = scope && !isTestScope(scope) ? ` into ${scope.sectionName}` : '';
    errors.push(
      `That file has ${table.rows.length} rows. Import at most ${most} at a time${where}.`,
    );
  }

  const headers = new Set(table.headers);
  const columns = isTestScope(scope) ? READ_COLUMNS : QUESTION_IMPORT_COLUMNS;
  for (const column of columns) {
    if (!column.required) continue;
    const header = normaliseHeader(column.header);
    const found = headers.has(header) || column.aliases.some((alias: string) => headers.has(alias));
    if (!found) errors.push(`The column "${column.header}" is missing`);
  }

  return errors;
}

/** The bank's hundred, a section's fifty, and a whole test fifty for each of its sections. */
function mostRowsFor(scope: SheetScope | null): number {
  if (scope === null) return QUESTION_IMPORT_MAX_ROWS;
  if (isTestScope(scope)) return SECTION_IMPORT_MAX_ROWS * Math.max(scope.sections.size, 1);
  return SECTION_IMPORT_MAX_ROWS;
}

/** Which section a whole-test row is for, and what keeps it out: a name that is not there, a section shut, or no room left. */
function placeRow(
  row: CsvRow,
  test: TestImportScope,
  taken: Map<string, number>,
): Pick<RowJudgement, 'scope' | 'sectionName' | 'sectionIssue' | 'claimRoom' | 'assignmentId'> {
  const sectionName = cellOf(row, QUESTION_IMPORT_SECTION_COLUMN.key);
  const section = test.sections.get(lookupName(sectionName));
  const refused = (code: ValidationIssue['code'], message: string): ValidationIssue => ({
    code,
    message,
    column: QUESTION_IMPORT_SECTION_COLUMN.key,
  });

  if (!section) {
    const message = blank(sectionName)
      ? 'Name the section'
      : `"${sectionName}" is not a section of this test`;
    return { scope: null, sectionName, sectionIssue: refused(CODE.SECTION_UNKNOWN, message) };
  }
  if (section.closed) {
    return {
      scope: section,
      sectionName,
      sectionIssue: refused(CODE.SECTION_NOT_OPEN, section.closed),
    };
  }
  return {
    scope: section,
    sectionName,
    assignmentId: section.assignmentId,
    claimRoom: () => {
      const used = taken.get(section.id) ?? 0;
      if (used >= section.room) {
        return refused(
          CODE.SECTION_FULL,
          `Over ${section.sectionName}'s room of ${section.room} — not imported`,
        );
      }
      taken.set(section.id, used + 1);
      return null;
    },
  };
}

function planRow(
  row: CsvRow,
  catalog: TaxonomyCatalog,
  dedup: ImportDedupContext,
  lineByHash: Map<string, number>,
  codesInFile: Set<string>,
  { edit, leftOut, scope, sectionName, sectionIssue, claimRoom, assignmentId }: RowJudgement,
): PlannedRow {
  const issues: ValidationIssue[] = sectionIssue ? [sectionIssue] : [];
  const warnings: ImportWarning[] = [];
  const { content, names, draft } = readRow(row, catalog, edit, issues, warnings);

  // The core rules run on every row, whatever the sheet got wrong: an admin fixing one column should see the rest of that row's problems in the same pass.
  issues.push(...validateQuestion(draft, catalog.context));

  const languages = languagesIn(draft.stem);
  const stemHash = languages.length > 0 ? computeStemHash(draft) : null;
  const duplicateOf = stemHash ? duplicateFor(stemHash, dedup, lineByHash) : null;

  // Only a row that would be written can clash: a row that is already in the bank is carrying the code it was imported with, and re-uploading last week's sheet must not turn every coded row into an error.
  const code = draft.questionCode;
  if (code && !duplicateOf && !leftOut) {
    const taken = claimCode(code, dedup, codesInFile);
    if (taken) issues.push(taken);
  }

  if (scope) issues.push(...sectionRefusals(draft, scope));

  const reported = dedupeIssues(issues);

  let action: QuestionImportAction = leftOut
    ? 'left_out'
    : actionFor(reported.length > 0, duplicateOf);
  // Room is spent only by a row that would really be written, so a skipped or repeated row frees it for the next.
  const full = action === 'create' ? (claimRoom?.() ?? null) : null;
  if (full) {
    reported.push(full);
    action = 'skip';
  }

  // Only a row that will really be written claims its stem. A skipped row that held the hash would make the next good copy of the same question a duplicate of a line nothing was ever created from.
  if (stemHash && action === 'create') lineByHash.set(stemHash, row.line);

  return {
    line: row.line,
    action,
    stemPreview: preview(draft.stem[leadLanguageIn(draft.stem)] ?? ''),
    subjectName: names.subject || null,
    topicName: names.topic || null,
    languages,
    issues: reported,
    warnings,
    duplicateOf,
    draft: action === 'create' ? draft : null,
    stemHash,
    questionCode: code ?? null,
    pictures: content.pictures,
    editable: draft,
    assignmentId: assignmentId ?? null,
    missing: missingOf(row, edit !== undefined, names, draft.subjectId, reported),
    edited: edit !== undefined,
    ...(sectionName === undefined ? {} : { sectionName }),
  };
}

/** A row as the question it reads as, the pictures its cells carry, and the names it is filed under. */
interface ReadRow {
  content: RowContent;
  names: { subject: string; topic: string };
  draft: QuestionDraft;
}

/** A corrected line is judged as corrected; its cells still name the pictures it may keep showing. */
function readRow(
  row: CsvRow,
  catalog: TaxonomyCatalog,
  edit: QuestionDraft | undefined,
  issues: ValidationIssue[],
  warnings: ImportWarning[],
): ReadRow {
  if (edit) {
    // The review window's editor has no code field, so an edit naming none keeps the sheet's.
    const questionCode =
      edit.questionCode === undefined ? readCode(row, issues) : edit.questionCode;
    const draft = withImportTag({ ...edit, questionCode });
    if (draft.tags.length > TAGS_MAX) issues.push(TOO_MANY_TAGS);
    return { content: rowContent(row, [], []), names: namesOf(edit, catalog), draft };
  }

  const content = rowContent(row, issues, warnings);
  const names = { subject: cellOf(row, 'subject'), topic: cellOf(row, 'topic') };
  const draft = buildDraft(row, content, readType(row, issues), names, catalog, issues);
  warnOfInlinePassage(draft, warnings);
  return { content, names, draft };
}

/** The first row that would write a code holds it; the bank's own and an earlier line's are a clash. */
function claimCode(
  code: string,
  dedup: ImportDedupContext,
  codesInFile: Set<string>,
): ValidationIssue | null {
  if (!dedup.questionIdByCode.has(code) && !codesInFile.has(code)) {
    codesInFile.add(code);
    return null;
  }
  return {
    code: CODE.QUESTION_CODE_TAKEN,
    message: `The code ${code} is already used by another question`,
    field: 'questionCode',
    column: 'question_code',
  };
}

/** What a corrected line is filed under, by name, as the preview lists every row. */
function namesOf(
  draft: QuestionDraft,
  catalog: TaxonomyCatalog,
): { subject: string; topic: string } {
  return {
    subject: catalog.context.subjects.get(draft.subjectId)?.name ?? '',
    topic: draft.topicId ? (catalog.context.topics.get(draft.topicId)?.name ?? '') : '',
  };
}

/** A correction cannot shed the tag every imported question carries. */
function withImportTag(draft: QuestionDraft): QuestionDraft {
  return draft.tags.includes(QUESTION_IMPORT_TAG)
    ? draft
    : { ...draft, tags: [QUESTION_IMPORT_TAG, ...draft.tags] };
}

/** How one line is judged beyond its own cells: a correction, a setting aside, and the section it lands in. */
interface RowJudgement {
  edit: QuestionDraft | undefined;
  leftOut: boolean;
  scope: ImportScope | null;
  /** A whole-test row's section as its sheet names it. */
  sectionName?: string;
  /** Why a whole-test row cannot go into the section it names. */
  sectionIssue?: ValidationIssue;
  /** Takes one of the section's places for a row about to be written; the issue when none is left. */
  claimRoom?: () => ValidationIssue | null;
  assignmentId?: string | null;
}

function sectionRefusals(draft: QuestionDraft, scope: ImportScope): ValidationIssue[] {
  return [outsideSection(draft, scope), wrongKindFor(draft, scope)].filter(
    (issue) => issue !== null,
  );
}

/** A row filed under a subject the section it is going into does not take. */
function outsideSection(draft: QuestionDraft, scope: ImportScope): ValidationIssue | null {
  const { subject, sectionName } = scope;
  if (!subject || !draft.subjectId || draft.subjectId === subject.id) return null;
  return {
    code: CODE.SUBJECT_OUTSIDE_SECTION,
    message: `Only ${subject.name} questions go into ${sectionName}`,
    field: 'subjectId',
    column: 'subject',
  };
}

/** A row of a kind its section's paper could never draw: a section is answered, typed or written. */
function wrongKindFor(draft: QuestionDraft, scope: ImportScope): ValidationIssue | null {
  if (SECTION_QUESTION_TYPES[scope.kind].includes(draft.type)) return null;
  return {
    code: CODE.TYPE_OUTSIDE_SECTION,
    message: `${scope.sectionName} ${TAKES_ONLY[scope.kind]}`,
    field: 'type',
    column: 'type',
  };
}

const TAKES_ONLY: Readonly<Record<SectionAnswerKind, string>> = {
  CHOICE: 'takes no typing passage and no descriptive question',
  TYPING: 'is a typing test, so only typing passages go into it',
  WRITING: 'is descriptive, so only descriptive questions go into it',
};

/** A row with anything to report is never written, so the duplicate it repeats does not matter. */
function actionFor(hasIssues: boolean, duplicateOf: string | null): QuestionImportAction {
  if (hasIssues) return 'skip';
  return duplicateOf ? 'duplicate' : 'create';
}

/** A repeat is skipped rather than reported as an error: re-uploading last week's sheet with ten new questions on the end is the normal way to use this. */
function duplicateFor(
  stemHash: string,
  dedup: ImportDedupContext,
  lineByHash: Map<string, number>,
): string | null {
  const existing = dedup.questionIdByHash.get(stemHash);
  if (existing) return existing;

  const earlier = lineByHash.get(stemHash);
  return earlier === undefined ? null : fileDuplicateOf(earlier);
}

/** The sheet and the core reach the same conclusion by different routes: a subject the sheet cannot resolve leaves no id, which the core then reports as a missing one. For those three fields the FIRST issue wins — the sheet's, which quotes what was actually typed — so one line of the preview says a thing once. */
const TAXONOMY_FIELDS = new Set(['subjectId', 'topicId']);

function dedupeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const field = issue.field ?? '';
    const key = TAXONOMY_FIELDS.has(field) ? field : `${issue.code}:${field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const PREVIEW_LIMIT = 120;

function preview(stem: string): string {
  // Stripped BEFORE slicing: cutting html at 120 characters can land inside a tag.
  const text = previewTextOf(stem);
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT - 1)}…` : text;
}

/** What the client is allowed to see: the plan without the drafts behind it. */
export function withoutDrafts(
  planning: QuestionImportPlanning,
  importLogId: string,
): QuestionImportPlan {
  return {
    importLogId,
    rows: planning.rows.map(
      ({
        draft: _draft,
        stemHash: _stemHash,
        pictures: _pictures,
        editable: _editable,
        assignmentId: _assignmentId,
        missing: _missing,
        ...row
      }) => row,
    ),
    summary: planning.summary,
    fileErrors: planning.fileErrors,
    ...(planning.causes ? { causes: planning.causes } : {}),
  };
}
