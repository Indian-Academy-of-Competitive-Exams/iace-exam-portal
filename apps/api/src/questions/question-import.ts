import {
  LANGUAGE_LABELS,
  ANSWER_MODE,
  DEFAULT_LANGUAGE,
  FORMULA_PICTURE_MAX_HEIGHT,
  LANGUAGE_ORDER,
  MCQ_OPTION_MAX,
  previewTextOf,
  QUESTION_IMPORT_COLUMNS,
  QUESTION_IMPORT_MAX_ROWS,
  QUESTION_IMPORT_SECTION_COLUMN,
  SECTION_IMPORT_MAX_ROWS,
  fileDuplicateOf,
  QUESTION_IMPORT_TAG,
  IMPORT_FIX_KINDS,
  DIFFICULTY_LABELS,
  DIFFICULTY_LEVELS,
  canonicalName,
  QUESTION_TYPE,
  QUESTION_VALIDATION_CODE,
  TAG_SEPARATOR,
  TAGS_MAX,
  difficultyLevelSchema,
  questionCodeSchema,
  questionTypeSchema,
  tagSchema,
  toleranceSchema,
  type AnswerMode,
  type ImportFix,
  type ImportFixKind,
  type ImportWarning,
  type LocalizedText,
  type QuestionDraft,
  type QuestionImportAction,
  type QuestionImportPlan,
  type QuestionImportRow,
  type ValidationIssue,
  SECTION_QUESTION_TYPES,
  type SectionAnswerKind,
  type QuestionType,
} from '@iace/contracts';
import { type CsvRow, type CsvTable, normaliseHeader } from '../common/importing';
import { htmlFromCell } from './question-content';
import { opensWithPassage } from './question-passage';
import { importedImageKey, judgeQuestionImage, type CheckedImage } from './question-images';
import { computeStemHash, languagesIn, validateQuestion } from './question-core';
import { lookupName, topicKey, type TaxonomyCatalog } from './taxonomy-context';

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

/** A subject, topic or difficulty the sheet names that the bank does not hold. */
type MissingValue = Omit<ImportFix, 'suggestions'>;

const MISSING_CODES: Readonly<Record<ImportFixKind, readonly string[]>> = {
  [IMPORT_FIX_KINDS.SUBJECT]: [CODE.SUBJECT_UNKNOWN],
  [IMPORT_FIX_KINDS.TOPIC]: [CODE.TOPIC_UNKNOWN, CODE.TOPIC_NOT_IN_SUBJECT],
  [IMPORT_FIX_KINDS.DIFFICULTY]: [CODE.DIFFICULTY_INVALID],
};

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

const READ_COLUMNS = [...QUESTION_IMPORT_COLUMNS, QUESTION_IMPORT_SECTION_COLUMN];

/** Column key -> the normalised header the parser will find it under. */
const HEADER_BY_KEY = new Map<string, string>(
  READ_COLUMNS.map((column) => [column.key, normaliseHeader(column.header)]),
);

const ALIASES_BY_KEY = new Map<string, readonly string[]>(
  READ_COLUMNS.map((column) => [column.key, column.aliases as readonly string[]]),
);

const LABEL_BY_KEY = new Map<string, string>(
  READ_COLUMNS.map((column) => [column.key, column.header]),
);

/** What a candidate reads may carry a picture; a subject, a code or a typed answer is only ever text. */
const TAKES_PICTURES = /^(stem|passage|option\d|solution)_/;

/** A cell, by column key, accepting any alias the sheet happens to use. */
export function cellOf(row: CsvRow, key: string): string {
  const header = HEADER_BY_KEY.get(key);
  if (header && row.values[header] !== undefined) return row.values[header].trim();

  for (const alias of ALIASES_BY_KEY.get(key) ?? []) {
    const value = row.values[alias];
    if (value !== undefined) return value.trim();
  }
  return '';
}

/** The pictures floating over a cell, found under the same header or alias as its text. */
function picturesAt(row: CsvRow, key: string): Buffer[] {
  if (!row.pictures) return [];
  const header = HEADER_BY_KEY.get(key);
  const found = header ? row.pictures[header] : undefined;
  if (found) return found;
  for (const alias of ALIASES_BY_KEY.get(key) ?? []) {
    const aliased = row.pictures[alias];
    if (aliased) return aliased;
  }
  return [];
}

/** One row's readable cells as html, collecting the pictures each places and reporting any it cannot. */
interface RowContent {
  html: (key: string) => string;
  pictures: Map<string, CheckedImage>;
}

function rowContent(row: CsvRow, issues: ValidationIssue[], warnings: ImportWarning[]): RowContent {
  const pictures = new Map<string, CheckedImage>();

  for (const column of QUESTION_IMPORT_COLUMNS) {
    if (TAKES_PICTURES.test(column.key) || picturesAt(row, column.key).length === 0) continue;
    issues.push(
      pictureIssue(column.key, `A picture sits over ${column.header}, which only takes text`),
    );
  }

  const html = (key: string): string => {
    const keys: string[] = [];
    for (const [index, bytes] of picturesAt(row, key).entries()) {
      const judged = judgeQuestionImage(bytes);
      if ('problem' in judged) {
        issues.push(
          pictureIssue(
            key,
            `Picture ${index + 1} over ${LABEL_BY_KEY.get(key)}: ${judged.problem}`,
          ),
        );
        continue;
      }
      if (judged.height <= FORMULA_PICTURE_MAX_HEIGHT) {
        warnings.push({
          column: key,
          message: String.raw`${LABEL_BY_KEY.get(key)}: this picture looks like a formula saved at text size (${judged.width}×${judged.height} px), so it will look blurry. Type it as \( … \) to make it a real equation.`,
        });
      }
      const stored = importedImageKey(judged);
      pictures.set(stored, judged);
      keys.push(stored);
    }
    return htmlFromCell(cellOf(row, key), keys);
  };

  return { html, pictures };
}

/** Keyed by column, so two bad pictures in two cells are two lines of the preview, not one. */
function pictureIssue(column: string, message: string): ValidationIssue {
  return { code: CODE.PICTURE_INVALID, message, field: `picture:${column}`, column };
}

const blank = (value: string) => value.trim() === '';

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

type Cause = NonNullable<QuestionImportPlan['causes']>[number];

/** Each reason held against more than one row, or naming a value that can be fixed, once with its count; most first. */
function causesOf(rows: readonly PlannedRow[], catalog: TaxonomyCatalog): Cause[] {
  const causes = new Map<string, Cause>();
  for (const row of rows) {
    if (row.action !== 'skip') continue;
    const said = new Set<string>();
    for (const issue of row.issues) {
      const missing =
        row.missing && MISSING_CODES[row.missing.kind].includes(issue.code) ? row.missing : null;
      // A missing value is one cause however the sheet cased it: one choice fixes every spelling.
      const key = missing
        ? [missing.kind, missing.subjectId ?? '', lookupName(missing.value)].join('|')
        : issue.message;
      if (said.has(key)) continue;
      said.add(key);
      const held = causes.get(key);
      if (held) {
        held.count += 1;
        continue;
      }
      causes.set(key, {
        message: issue.message,
        count: 1,
        ...(missing ? { fix: { ...missing, suggestions: suggestionsFor(missing, catalog) } } : {}),
      });
    }
  }
  return [...causes.values()]
    .filter((cause) => cause.count > 1 || cause.fix)
    .sort((a, b) => b.count - a.count);
}

/** The bank's own values closest to the one the sheet names, by the words they share; best three. */
function suggestionsFor(missing: MissingValue, catalog: TaxonomyCatalog): ImportFix['suggestions'] {
  if (missing.kind === IMPORT_FIX_KINDS.DIFFICULTY) {
    return DIFFICULTY_LEVELS.map((level) => ({ value: level, label: DIFFICULTY_LABELS[level] }));
  }
  const choices =
    missing.kind === IMPORT_FIX_KINDS.SUBJECT
      ? catalog.subjects.map((subject) => ({ value: subject.id, label: subject.name }))
      : (catalog.subjects
          .find((subject) => subject.id === missing.subjectId)
          ?.topics.map((topic) => ({ value: topic.id, label: topic.name })) ?? []);
  const wanted = new Set(wordsOf(missing.value));
  return choices
    .map((choice) => ({
      choice,
      shared: wordsOf(choice.label).filter((word) => wanted.has(word)).length,
    }))
    .filter(({ shared }) => shared > 0)
    .sort((a, b) => b.shared - a.shared || a.choice.label.localeCompare(b.choice.label))
    .slice(0, SUGGESTIONS_MAX)
    .map(({ choice }) => choice);
}

const SUGGESTIONS_MAX = 3;

/** Words worth matching on: "AND", "OF" and "THE" would pair every long name with every other. */
const FILLER_WORDS: ReadonlySet<string> = new Set(['AND', 'OF', 'THE', 'IN', 'FOR']);

const wordsOf = (value: string): string[] =>
  canonicalName(value)
    .split(/[^A-Z0-9]+/)
    .filter((word) => word.length > 1 && !FILLER_WORDS.has(word));

/** What keeps a row out when it is a value the bank does not hold, read off the sheet as written. */
function missingOf(
  row: CsvRow,
  edited: boolean,
  names: { subject: string; topic: string },
  subjectId: string,
  issues: readonly ValidationIssue[],
): MissingValue | null {
  if (edited) return null;
  const codes = new Set(issues.map((issue) => issue.code));
  if (codes.has(CODE.SUBJECT_UNKNOWN))
    return { kind: IMPORT_FIX_KINDS.SUBJECT, value: names.subject };
  if (codes.has(CODE.TOPIC_UNKNOWN) || codes.has(CODE.TOPIC_NOT_IN_SUBJECT)) {
    return { kind: IMPORT_FIX_KINDS.TOPIC, value: names.topic, subjectId };
  }
  const difficulty = cellOf(row, 'difficulty');
  if (codes.has(CODE.DIFFICULTY_INVALID) && !blank(difficulty)) {
    return { kind: IMPORT_FIX_KINDS.DIFFICULTY, value: difficulty };
  }
  return null;
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
  const stemHash = languages.includes(DEFAULT_LANGUAGE) ? computeStemHash(draft) : null;
  const duplicateOf = stemHash ? duplicateFor(stemHash, dedup, lineByHash) : null;

  // Only a row that would be written can clash: a row that is already in the bank is carrying the code it was imported with, and re-uploading last week's sheet must not turn every coded row into an error.
  const code = draft.questionCode;
  if (code && !duplicateOf && !leftOut) {
    const taken = claimCode(code, dedup, codesInFile);
    if (taken) issues.push(taken);
  }

  const outside = scope ? outsideSection(draft, scope) : null;
  if (outside) issues.push(outside);
  const wrongKind = scope ? wrongKindFor(draft, scope) : null;
  if (wrongKind) issues.push(wrongKind);

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
    stemPreview: preview(draft.stem[DEFAULT_LANGUAGE] ?? ''),
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

/** The kinds whose sheet row carries an answer: the value compared against, or the key points, one a line. */
const KEYED_TYPES: ReadonlySet<QuestionType> = new Set([
  QUESTION_TYPE.TEXT_FIELD,
  QUESTION_TYPE.DESCRIPTIVE,
]);

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

function readType(row: CsvRow, issues: ValidationIssue[]): QuestionDraft['type'] {
  const raw = cellOf(row, 'type');
  if (blank(raw)) return QUESTION_TYPE.SINGLE_MCQ;

  const parsed = questionTypeSchema.safeParse(raw.toUpperCase().replace(/[\s-]+/g, '_'));
  if (parsed.success) return parsed.data;

  issues.push({
    code: CODE.TYPE_INVALID,
    message: `"${raw}" is not a question type`,
    field: 'type',
    column: 'type',
  });
  return QUESTION_TYPE.SINGLE_MCQ;
}

function buildDraft(
  row: CsvRow,
  content: RowContent,
  type: QuestionDraft['type'],
  names: { subject: string; topic: string },
  catalog: TaxonomyCatalog,
  issues: ValidationIssue[],
): QuestionDraft {
  const ids = resolveTaxonomy(names, catalog, issues);

  const draft: QuestionDraft = {
    type,
    subjectId: ids.subjectId ?? '',
    topicId: ids.topicId,
    difficulty: readDifficulty(row, catalog, issues),
    questionCode: readCode(row, issues),
    stem: localized('stem', content.html),
    passage: localized('passage', content.html),
    solution: localized('solution', content.html),
    options: type === QUESTION_TYPE.SINGLE_MCQ ? readOptions(row, content, issues) : [],
    answerKey: KEYED_TYPES.has(type) ? readAnswerKey(row, issues) : null,
    tags: readTags(row, issues),
  };

  return draft;
}

/** Names, not ids: a sheet says QUANTITATIVE APTITUDE and PERCENTAGES. Nothing is created from an import — a name that matches nothing is reported rather than invented. */
function resolveTaxonomy(
  names: { subject: string; topic: string },
  catalog: TaxonomyCatalog,
  issues: ValidationIssue[],
): { subjectId: string | null; topicId: string | null } {
  if (blank(names.subject)) {
    issues.push({
      code: CODE.SUBJECT_REQUIRED,
      message: 'Name the subject',
      field: 'subjectId',
      column: 'subject',
    });
    return { subjectId: null, topicId: null };
  }

  const subjectId = catalog.subjectIdByName.get(lookupName(names.subject)) ?? null;
  if (!subjectId) {
    issues.push({
      code: CODE.SUBJECT_UNKNOWN,
      message: `There is no subject called "${names.subject}"`,
      field: 'subjectId',
      column: 'subject',
    });
    return { subjectId: null, topicId: null };
  }

  if (blank(names.topic)) return { subjectId, topicId: null };

  const topicId = catalog.topicIdBySubjectAndName.get(topicKey(subjectId, lookupName(names.topic)));
  if (!topicId) {
    issues.push({
      code: CODE.TOPIC_UNKNOWN,
      message: `"${names.topic}" is not a topic of "${names.subject}"`,
      field: 'topicId',
      column: 'topic',
    });
    return { subjectId, topicId: null };
  }

  return { subjectId, topicId };
}

function readDifficulty(
  row: CsvRow,
  catalog: TaxonomyCatalog,
  issues: ValidationIssue[],
): QuestionDraft['difficulty'] {
  const raw = cellOf(row, 'difficulty');
  const parsed = difficultyLevelSchema.safeParse(raw.toUpperCase());
  if (parsed.success) return parsed.data;
  const chosen = catalog.difficultyAliases?.get(canonicalName(raw));
  if (chosen) return chosen;

  issues.push({
    code: CODE.DIFFICULTY_INVALID,
    message: blank(raw) ? 'Give the question a difficulty' : `"${raw}" is not a difficulty`,
    field: 'difficulty',
    column: 'difficulty',
  });
  return 'MEDIUM';
}

function readCode(row: CsvRow, issues: ValidationIssue[]): string | null {
  const raw = cellOf(row, 'question_code');
  if (blank(raw)) return null;

  const parsed = questionCodeSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  issues.push({
    code: CODE.QUESTION_CODE_INVALID,
    message: `"${raw}" is not a usable question code`,
    field: 'questionCode',
    column: 'question_code',
  });
  return null;
}

/** A passage typed above its question in the question cell is pointed out, and left where it is. */
function warnOfInlinePassage(draft: QuestionDraft, warnings: ImportWarning[]): void {
  for (const language of LANGUAGE_ORDER) {
    if (!blank(draft.passage?.[language] ?? '')) continue;
    if (!opensWithPassage(draft.stem[language] ?? '')) continue;
    warnings.push({
      column: `stem_${language}`,
      message: `The ${LANGUAGE_LABELS[language]} question may open with a passage. Move it to passage_${language} to show it beside the question`,
    });
  }
}

/** One field across every language, each cell read through `read`. */
function localized(field: string, read: (key: string) => string): LocalizedText {
  const values: LocalizedText = {};
  for (const language of LANGUAGE_ORDER) {
    const value = read(`${field}_${language}`);
    if (!blank(value)) values[language] = value;
  }
  return values;
}

function readOptions(
  row: CsvRow,
  content: RowContent,
  issues: ValidationIssue[],
): QuestionDraft['options'] {
  const correct = readCorrectOption(row, issues);

  const options: QuestionDraft['options'] = [];
  for (let position = 1; position <= MCQ_OPTION_MAX; position += 1) {
    const text = localized(`option${position}`, content.html);

    // An empty slot is not an option: reporting "option 4 has no text" for a row that only ever had three is less use than "this needs four options".
    if (Object.keys(text).length === 0) continue;
    options.push({ position, isCorrect: position === correct, text });
  }

  return options;
}

function readCorrectOption(row: CsvRow, issues: ValidationIssue[]): number | null {
  const raw = cellOf(row, 'correct_option');
  if (blank(raw)) return null;

  const value = Number(raw.replace(/^option\s*/i, ''));
  if (Number.isInteger(value) && value >= 1 && value <= MCQ_OPTION_MAX) return value;

  issues.push({
    code: CODE.CORRECT_OPTION_INVALID,
    message: `"${raw}" is not one of options 1 to ${MCQ_OPTION_MAX}`,
    field: 'options',
    column: 'correct_option',
  });
  return null;
}

function readAnswerKey(row: CsvRow, issues: ValidationIssue[]): QuestionDraft['answerKey'] {
  const answers = localized('answer', (key) => cellOf(row, key));
  const rawMode = cellOf(row, 'answer_mode');
  const rawTolerance = cellOf(row, 'answer_tolerance');

  let mode: AnswerMode = ANSWER_MODE.EXACT;
  if (!blank(rawMode)) {
    const upper = rawMode.toUpperCase();
    if (upper === ANSWER_MODE.EXACT || upper === ANSWER_MODE.NUMERIC) {
      mode = upper;
    } else {
      issues.push({
        code: CODE.ANSWER_MODE_INVALID,
        message: `"${rawMode}" is not an answer mode. Use EXACT or NUMERIC`,
        field: 'answerKey.mode',
        column: 'answer_mode',
      });
    }
  }

  if (blank(rawTolerance)) return { mode, answers };

  const tolerance = toleranceSchema.safeParse(Number(rawTolerance));
  if (!tolerance.success) {
    issues.push({
      code: CODE.ANSWER_NOT_NUMERIC,
      message: `"${rawTolerance}" is not a tolerance. Use a number from 0 to ${toleranceSchema.maxValue}`,
      field: 'answerKey.tolerance',
      column: 'answer_tolerance',
    });
    return { mode, answers };
  }

  return { mode, answers, tolerance: tolerance.data };
}

/** The mark takes one of the ten, so a row naming all ten is over the cap and is refused. */
const TOO_MANY_TAGS: ValidationIssue = {
  code: CODE.TAG_INVALID,
  message: `A question can carry at most ${TAGS_MAX} tags, and an imported one already carries "${QUESTION_IMPORT_TAG}"`,
  field: 'tags',
  column: 'tags',
};

function readTags(row: CsvRow, issues: ValidationIssue[]): string[] {
  const tags: string[] = [QUESTION_IMPORT_TAG];

  for (const part of cellOf(row, 'tags').split(TAG_SEPARATOR)) {
    if (blank(part)) continue;

    const parsed = tagSchema.safeParse(part);
    if (!parsed.success) {
      issues.push({
        code: CODE.TAG_INVALID,
        message: `"${part.trim()}" is not a usable tag`,
        field: 'tags',
        column: 'tags',
      });
      continue;
    }
    if (!tags.includes(parsed.data)) tags.push(parsed.data);
  }

  if (tags.length > TAGS_MAX) {
    issues.push(TOO_MANY_TAGS);
    return tags.slice(0, TAGS_MAX);
  }

  return tags;
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
