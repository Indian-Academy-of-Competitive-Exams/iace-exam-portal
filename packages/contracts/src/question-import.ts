import { z } from 'zod';
import { importPlanSchema } from './imports';
import {
  LANGUAGE_LABELS,
  languageSchema,
  SUPPORTED_LANGUAGES,
  type QuestionLanguage,
} from './question-content';
import { questionDraftSchema, validationIssueSchema } from './questions';

// ============================================================================
// The import sheet. These columns are the ONE definition of the format: the
// template is generated from them and the parser matches on them, so the sample
// cannot document a format the importer will not accept.
// ============================================================================

/** The header is what a person reads; the old snake_case name stays an alias, so a sheet filled in before still imports. */
const languageColumn = <Key extends string>(
  key: Key,
  label: string,
  width: number,
  language: QuestionLanguage,
  required = false,
) =>
  ({
    key,
    header: `${label} (${LANGUAGE_LABELS[language]})`,
    width,
    required,
    language,
    aliases: [key.replaceAll('_', '')],
  }) as const;

/** Six, as the model allows: an IBPS or SBI paper prints A to E. */
const optionColumns = (language: QuestionLanguage) =>
  ([1, 2, 3, 4, 5, 6] as const).map((position) =>
    languageColumn(`option${position}_${language}` as const, `Option ${position}`, 28, language),
  );

export const QUESTION_IMPORT_COLUMNS = [
  {
    key: 'type',
    header: 'Question Type',
    width: 16,
    required: false,
    aliases: ['type', 'questiontype'],
  },
  { key: 'subject', header: 'Subject', width: 22, required: true, aliases: ['subject'] },
  { key: 'topic', header: 'Topic', width: 22, required: false, aliases: ['topic'] },
  {
    key: 'difficulty',
    header: 'Difficulty',
    width: 12,
    required: true,
    aliases: ['difficulty', 'level'],
  },
  languageColumn('passage_en', 'Passage', 60, SUPPORTED_LANGUAGES.EN),
  languageColumn('passage_hi', 'Passage', 60, SUPPORTED_LANGUAGES.HI),
  languageColumn('passage_te', 'Passage', 60, SUPPORTED_LANGUAGES.TE),
  languageColumn('stem_en', 'Question', 60, SUPPORTED_LANGUAGES.EN, true),
  languageColumn('stem_hi', 'Question', 60, SUPPORTED_LANGUAGES.HI),
  languageColumn('stem_te', 'Question', 60, SUPPORTED_LANGUAGES.TE),
  ...optionColumns(SUPPORTED_LANGUAGES.EN),
  ...optionColumns(SUPPORTED_LANGUAGES.HI),
  ...optionColumns(SUPPORTED_LANGUAGES.TE),
  {
    key: 'correct_option',
    header: 'Correct Option',
    width: 16,
    required: false,
    aliases: ['correctoption', 'answerkey', 'correct'],
  },
  {
    key: 'answer_mode',
    header: 'Answer Mode',
    width: 14,
    required: false,
    aliases: ['answermode'],
  },
  languageColumn('answer_en', 'Typed Answer', 24, SUPPORTED_LANGUAGES.EN),
  languageColumn('answer_hi', 'Typed Answer', 24, SUPPORTED_LANGUAGES.HI),
  languageColumn('answer_te', 'Typed Answer', 24, SUPPORTED_LANGUAGES.TE),
  {
    key: 'answer_tolerance',
    header: 'Answer Tolerance',
    width: 18,
    required: false,
    aliases: ['answertolerance', 'tolerance'],
  },
  languageColumn('solution_en', 'Solution', 60, SUPPORTED_LANGUAGES.EN),
  languageColumn('solution_hi', 'Solution', 60, SUPPORTED_LANGUAGES.HI),
  languageColumn('solution_te', 'Solution', 60, SUPPORTED_LANGUAGES.TE),
  { key: 'tags', header: 'Tags', width: 30, required: false, aliases: ['tags', 'tag'] },
  {
    key: 'question_code',
    header: 'Question Code',
    width: 18,
    required: false,
    aliases: ['questioncode', 'code', 'qcode'],
  },
] as const;

/** Only a whole-test sheet carries it: which of the test's sections the row is typed into. */
export const QUESTION_IMPORT_SECTION_COLUMN = {
  key: 'section',
  header: 'Section',
  width: 24,
  required: true,
  aliases: ['section'],
} as const;

type QuestionImportColumn = (typeof QUESTION_IMPORT_COLUMNS)[number];
export type QuestionImportColumnKey = QuestionImportColumn['key'];

export const QUESTION_IMPORT_TEMPLATE_FILENAME = 'iace-questions-template.xlsx';

/** The sheet the rows are read from. The taxonomy lists live on their own tab. */
export const QUESTION_IMPORT_SHEETS = {
  QUESTIONS: 'Questions',
  INSTRUCTIONS: 'Instructions',
  LISTS: 'Lists',
} as const;

/** Bounded so one upload stays a single synchronous request, and a sheet stays something a person can review. */
export const QUESTION_IMPORT_MAX_ROWS = 100;

/** Smaller where the sheet lands in one section of a test: every row there is read again by a proof-reader. */
export const SECTION_IMPORT_MAX_ROWS = 50;

/** How `duplicateOf` names an earlier line of the same file, where anything else is a question id in the bank. */
const FILE_DUPLICATE_PREFIX = 'line ';

export const fileDuplicateOf = (line: number): string => `${FILE_DUPLICATE_PREFIX}${line}`;

/** The earlier line of the same file a row repeats; null when it repeats the bank, or nothing. */
export function repeatedLineOf(duplicateOf: string | null): number | null {
  if (!duplicateOf?.startsWith(FILE_DUPLICATE_PREFIX)) return null;
  return Number(duplicateOf.slice(FILE_DUPLICATE_PREFIX.length));
}

/** Several tags in one cell. */
export const TAG_SEPARATOR = ',';

/** A picture this short, in pixels, is a formula saved at text size: it will read blurry at any zoom. */
export const FORMULA_PICTURE_MAX_HEIGHT = 64;

/** Carried by every question a sheet creates, so one filter finds what an upload brought in. */
export const QUESTION_IMPORT_TAG = 'imported';

/** `create` writes the row; `duplicate` is a stem already in the bank or earlier in this file — skipped, not an error worth blocking the upload for; `skip` has issues; `left_out` was set aside in the review window. */
const questionImportActionSchema = z.enum(['create', 'duplicate', 'skip', 'left_out']);
export type QuestionImportAction = z.infer<typeof questionImportActionSchema>;

/** What a warning is about, so a screen counts and names each by its own kind. */
export const IMPORT_WARNING_KIND = {
  BLURRY_PICTURE: 'BLURRY_PICTURE',
  INLINE_PASSAGE: 'INLINE_PASSAGE',
} as const;
export type ImportWarningKind = (typeof IMPORT_WARNING_KIND)[keyof typeof IMPORT_WARNING_KIND];

/** Worth knowing but not wrong: the row still imports. `column` names the cell, by import key. */
const importWarningSchema = z.object({
  kind: z.enum(IMPORT_WARNING_KIND),
  column: z.string(),
  message: z.string(),
});
export type ImportWarning = z.infer<typeof importWarningSchema>;

const questionImportRowSchema = z.object({
  /** 1-based line in the uploaded file, header included, as Excel shows it. */
  line: z.number().int(),
  action: questionImportActionSchema,
  /** The English stem, shortened — enough to recognise the row in the preview. */
  stemPreview: z.string(),
  subjectName: z.string().nullable(),
  topicName: z.string().nullable(),
  languages: z.array(languageSchema),
  issues: z.array(validationIssueSchema),
  warnings: z.array(importWarningSchema),
  /** Corrected in the review window: judged as corrected, not as the sheet has it. */
  edited: z.boolean(),
  /** The question this row repeats: an id from the bank, or a line in this file. */
  duplicateOf: z.string().nullable(),
  /** A whole-test sheet's section for the row, as the sheet names it. */
  sectionName: z.string().nullish(),
});
export type QuestionImportRow = z.infer<typeof questionImportRowSchema>;

const questionImportSummarySchema = z.object({
  total: z.number().int(),
  willCreate: z.number().int(),
  duplicates: z.number().int(),
  invalid: z.number().int(),
  leftOut: z.number().int(),
});

/** A sheet value the bank does not hold, and what a reason in the preview can do about it. */
export const IMPORT_FIX_KINDS = {
  SUBJECT: 'SUBJECT',
  TOPIC: 'TOPIC',
  DIFFICULTY: 'DIFFICULTY',
} as const;
const importFixKindSchema = z.enum(IMPORT_FIX_KINDS);
export type ImportFixKind = z.infer<typeof importFixKindSchema>;

const importFixSchema = z.object({
  kind: importFixKindSchema,
  /** The value as the sheet has it. */
  value: z.string(),
  /** A topic's subject: a chosen or created topic goes under it. */
  subjectId: z.string().nullish(),
  /** The closest values the bank does hold, best first: an id for a subject or topic, else the value. */
  suggestions: z.array(z.object({ value: z.string(), label: z.string() })),
});
export type ImportFix = z.infer<typeof importFixSchema>;

/** Every row whose sheet has `from` for this attribute reads `to` instead, held on the run, never on the sheet. */
export const questionImportRemapSchema = z.object({
  kind: importFixKindSchema,
  from: z.string().min(1),
  to: z.string().min(1),
  subjectId: z.string().nullish(),
});
export type QuestionImportRemap = z.infer<typeof questionImportRemapSchema>;

export const questionImportPlanSchema = importPlanSchema(
  questionImportRowSchema,
  questionImportSummarySchema,
).extend({
  /** The run this preview opened. Commit names it rather than re-uploading the file. */
  importLogId: z.string(),
  /** Each reason a row is not imported, once, with how many rows it holds back; most first. */
  causes: z
    .array(
      z.object({ message: z.string(), count: z.number().int(), fix: importFixSchema.optional() }),
    )
    .optional(),
});
export type QuestionImportPlan = z.infer<typeof questionImportPlanSchema>;

/** A previewed row's question for the review window, corrections laid over the sheet; a Skip row may lack a subject. */
const questionImportDraftSchema = z.object({
  line: z.number().int(),
  draft: questionDraftSchema.extend({ subjectId: z.string() }),
});
export type QuestionImportDraft = z.infer<typeof questionImportDraftSchema>;
export const questionImportDraftsSchema = z.array(questionImportDraftSchema);

/** A previewed row set aside from Import, or brought back. */
export const questionImportLeaveOutSchema = z.object({ leftOut: z.boolean() });
export type QuestionImportLeaveOut = z.infer<typeof questionImportLeaveOutSchema>;

export const questionImportCommitSchema = z.object({
  importLogId: z.string().min(1),
});
export type QuestionImportCommitBody = z.infer<typeof questionImportCommitSchema>;

export const questionImportResultSchema = questionImportSummarySchema.extend({
  created: z.number().int(),
  skipped: z.number().int(),
});
export type QuestionImportResult = z.infer<typeof questionImportResultSchema>;

/** Under /imports, which is the one path with the larger body limit — see apps/api/src/common/body-parsers.ts. */
export const QUESTION_IMPORT_ROUTES = {
  template: '/imports/questions/template',
  preview: '/imports/questions/preview',
  commit: '/imports/questions/commit',
  errors: '/imports/questions/errors',
  drafts: (importLogId: string) => `/imports/questions/${importLogId}/drafts`,
  row: (importLogId: string, line: number) => `/imports/questions/${importLogId}/rows/${line}`,
  leaveOut: (importLogId: string, line: number) =>
    `/imports/questions/${importLogId}/rows/${line}/left-out`,
  /** One missing value read as another, on every row of the run that has it. */
  remap: (importLogId: string) => `/imports/questions/${importLogId}/remap`,
  /** The run judged again as the bank stands now — after a subject or topic was added. */
  rejudge: (importLogId: string) => `/imports/questions/${importLogId}/rejudge`,
} as const;
