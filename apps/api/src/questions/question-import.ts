import {
  ANSWER_MODE,
  DEFAULT_LANGUAGE,
  FORMULA_PICTURE_MAX_HEIGHT,
  LANGUAGE_ORDER,
  MCQ_OPTION_COUNT,
  previewTextOf,
  QUESTION_IMPORT_COLUMNS,
  QUESTION_IMPORT_MAX_ROWS,
  QUESTION_IMPORT_TAG,
  QUESTION_TYPE,
  QUESTION_VALIDATION_CODE,
  TAG_SEPARATOR,
  TAGS_MAX,
  difficultyLevelSchema,
  questionCodeSchema,
  questionTypeSchema,
  tagSchema,
  type AnswerMode,
  type ImportWarning,
  type LocalizedText,
  type QuestionDraft,
  type QuestionImportAction,
  type QuestionImportPlan,
  type QuestionImportRow,
  type ValidationIssue,
} from '@iace/contracts';
import { type CsvRow, type CsvTable, normaliseHeader } from '../common/importing';
import { htmlFromCell } from './question-content';
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
}

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

/** Column key -> the normalised header the parser will find it under. */
const HEADER_BY_KEY = new Map<string, string>(
  QUESTION_IMPORT_COLUMNS.map((column) => [column.key, normaliseHeader(column.header)]),
);

const ALIASES_BY_KEY = new Map<string, readonly string[]>(
  QUESTION_IMPORT_COLUMNS.map((column) => [column.key, column.aliases as readonly string[]]),
);

const LABEL_BY_KEY = new Map<string, string>(
  QUESTION_IMPORT_COLUMNS.map((column) => [column.key, column.header]),
);

/** What a candidate reads may carry a picture; a subject, a code or a typed answer is only ever text. */
const TAKES_PICTURES = /^(stem|option\d|solution)_/;

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
): QuestionImportPlanning {
  const fileErrors = fileLevelErrors(table);
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

  const rows = table.rows.map((row) =>
    planRow(row, catalog, dedup, lineByHash, codesInFile, {
      edit: edits.get(row.line),
      leftOut: leftOut.has(row.line),
    }),
  );

  return {
    rows,
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

function fileLevelErrors(table: CsvTable): string[] {
  const errors: string[] = [];

  if (table.rows.length === 0) {
    errors.push('That file has no question rows');
    return errors;
  }

  if (table.rows.length > QUESTION_IMPORT_MAX_ROWS) {
    errors.push(
      `That file has ${table.rows.length} rows. Import at most ${QUESTION_IMPORT_MAX_ROWS} at a time.`,
    );
  }

  const headers = new Set(table.headers);
  for (const column of QUESTION_IMPORT_COLUMNS) {
    if (!column.required) continue;
    const header = normaliseHeader(column.header);
    const found = headers.has(header) || column.aliases.some((alias: string) => headers.has(alias));
    if (!found) errors.push(`The column "${column.header}" is missing`);
  }

  return errors;
}

function planRow(
  row: CsvRow,
  catalog: TaxonomyCatalog,
  dedup: ImportDedupContext,
  lineByHash: Map<string, number>,
  codesInFile: Set<string>,
  { edit, leftOut }: { edit: QuestionDraft | undefined; leftOut: boolean },
): PlannedRow {
  const issues: ValidationIssue[] = [];
  const warnings: ImportWarning[] = [];

  // A corrected line is judged as corrected; its cells still name the pictures it may keep showing.
  const content = rowContent(row, edit ? [] : issues, edit ? [] : warnings);
  const names = edit
    ? namesOf(edit, catalog)
    : { subject: cellOf(row, 'subject'), topic: cellOf(row, 'topic') };
  const draft = edit
    ? withImportTag(edit)
    : buildDraft(row, content, readType(row, issues), names, catalog, issues);

  // The core rules run on every row, whatever the sheet got wrong: an admin fixing one column should see the rest of that row's problems in the same pass.
  issues.push(...validateQuestion(draft, catalog.context));

  const languages = languagesIn(draft.stem);
  const stemHash = languages.includes(DEFAULT_LANGUAGE) ? computeStemHash(draft) : null;
  const duplicateOf = stemHash ? duplicateFor(stemHash, dedup, lineByHash) : null;

  // Only a row that would be written can clash: a row that is already in the bank is carrying the code it was imported with, and re-uploading last week's sheet must not turn every coded row into an error.
  const code = draft.questionCode;
  if (code && !duplicateOf && !leftOut) {
    if (dedup.questionIdByCode.has(code) || codesInFile.has(code)) {
      issues.push({
        code: CODE.QUESTION_CODE_TAKEN,
        message: `The code ${code} is already used by another question`,
        field: 'questionCode',
        column: 'question_code',
      });
    } else {
      codesInFile.add(code);
    }
  }

  const reported = dedupeIssues(issues);

  const action: QuestionImportAction = leftOut
    ? 'left_out'
    : actionFor(reported.length > 0, duplicateOf);

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
    edited: edit !== undefined,
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
  return earlier === undefined ? null : `line ${earlier}`;
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
    difficulty: readDifficulty(row, issues),
    questionCode: readCode(row, issues),
    stem: localized('stem', content.html),
    solution: localized('solution', content.html),
    options: type === QUESTION_TYPE.SINGLE_MCQ ? readOptions(row, content, issues) : [],
    answerKey: type === QUESTION_TYPE.TEXT_FIELD ? readAnswerKey(row, issues) : null,
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

function readDifficulty(row: CsvRow, issues: ValidationIssue[]): QuestionDraft['difficulty'] {
  const raw = cellOf(row, 'difficulty');
  const parsed = difficultyLevelSchema.safeParse(raw.toUpperCase());
  if (parsed.success) return parsed.data;

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
  for (let position = 1; position <= MCQ_OPTION_COUNT; position += 1) {
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
  if (Number.isInteger(value) && value >= 1 && value <= MCQ_OPTION_COUNT) return value;

  issues.push({
    code: CODE.CORRECT_OPTION_INVALID,
    message: `"${raw}" is not one of options 1 to ${MCQ_OPTION_COUNT}`,
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

  const tolerance = Number(rawTolerance);
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    issues.push({
      code: CODE.ANSWER_NOT_NUMERIC,
      message: `"${rawTolerance}" is not a tolerance`,
      field: 'answerKey.tolerance',
      column: 'answer_tolerance',
    });
    return { mode, answers };
  }

  return { mode, answers, tolerance };
}

/** The mark takes one of the ten, so a sheet naming all ten is over the cap and the row is refused. */
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
    issues.push({
      code: CODE.TAG_INVALID,
      message: `A question can carry at most ${TAGS_MAX} tags, and an imported one already carries "${QUESTION_IMPORT_TAG}"`,
      field: 'tags',
      column: 'tags',
    });
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
      ({ draft: _draft, stemHash: _stemHash, pictures: _pictures, editable: _editable, ...row }) =>
        row,
    ),
    summary: planning.summary,
    fileErrors: planning.fileErrors,
  };
}
