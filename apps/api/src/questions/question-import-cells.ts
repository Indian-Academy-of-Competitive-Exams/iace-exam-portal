import {
  QUESTION_VALIDATION_CODE,
  LANGUAGE_LABELS,
  ANSWER_MODE,
  FORMULA_PICTURE_MAX_HEIGHT,
  LANGUAGE_ORDER,
  MCQ_OPTION_MAX,
  QUESTION_IMPORT_COLUMNS,
  QUESTION_IMPORT_SECTION_COLUMN,
  QUESTION_IMPORT_TAG,
  canonicalName,
  QUESTION_TYPE,
  TAG_SEPARATOR,
  TAGS_MAX,
  difficultyLevelSchema,
  questionCodeSchema,
  questionTypeSchema,
  tagSchema,
  toleranceSchema,
  type AnswerMode,
  type ImportWarning,
  type LocalizedText,
  type QuestionDraft,
  type ValidationIssue,
  type QuestionType,
} from '@iace/contracts';
import { type CsvRow, normaliseHeader } from '../common/importing';
import { htmlFromCell } from './question-content';
import { opensWithPassage } from './question-passage';
import { importedImageKey, judgeQuestionImage, type CheckedImage } from './question-images';
import { lookupName, topicKey, type TaxonomyCatalog } from './taxonomy-context';

const CODE = QUESTION_VALIDATION_CODE;

export const READ_COLUMNS = [...QUESTION_IMPORT_COLUMNS, QUESTION_IMPORT_SECTION_COLUMN];

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
export interface RowContent {
  html: (key: string) => string;
  pictures: Map<string, CheckedImage>;
}

export function rowContent(
  row: CsvRow,
  issues: ValidationIssue[],
  warnings: ImportWarning[],
): RowContent {
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

export const blank = (value: string) => value.trim() === '';

/** The kinds whose sheet row carries an answer: the value compared against, or the key points, one a line. */
const KEYED_TYPES: ReadonlySet<QuestionType> = new Set([
  QUESTION_TYPE.TEXT_FIELD,
  QUESTION_TYPE.DESCRIPTIVE,
]);

export function readType(row: CsvRow, issues: ValidationIssue[]): QuestionDraft['type'] {
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

export function buildDraft(
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

export function readCode(row: CsvRow, issues: ValidationIssue[]): string | null {
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
export function warnOfInlinePassage(draft: QuestionDraft, warnings: ImportWarning[]): void {
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
export const TOO_MANY_TAGS: ValidationIssue = {
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
