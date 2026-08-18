import { z } from 'zod';
import { optionalBooleanQuery, searchQuery } from './common';
import { paginationQuerySchema } from './envelope';
import { canonicalNameSchema } from './naming';

// ============================================================================
// The question bank: the taxonomy a question hangs off, the ONE input shape both
// the single-question form and the importer post, and the preview that importer
// answers with. A question is multilingual — English always, Hindi and Telugu
// when the institute has them.
// ============================================================================

/**
 * The languages a question may be authored in. These are the KEYS inside
 * `Question.content` and `QuestionOption.text`, so a value here is a column in
 * the import sheet and a tab in the form — adding one is not a rename.
 */
export const SUPPORTED_LANGUAGES = {
  EN: 'en',
  HI: 'hi',
  TE: 'te',
} as const;
export const languageSchema = z.enum(SUPPORTED_LANGUAGES);
export type QuestionLanguage = z.infer<typeof languageSchema>;

/** English is mandatory on every question: it is what the bank is searched and deduped by. */
export const DEFAULT_LANGUAGE: QuestionLanguage = SUPPORTED_LANGUAGES.EN;

/** Authoring order — the tab order in the form and the column order in the sheet. */
export const LANGUAGE_ORDER = [
  SUPPORTED_LANGUAGES.EN,
  SUPPORTED_LANGUAGES.HI,
  SUPPORTED_LANGUAGES.TE,
] as const;

export const LANGUAGE_LABELS: Record<QuestionLanguage, string> = {
  [SUPPORTED_LANGUAGES.EN]: 'English',
  [SUPPORTED_LANGUAGES.HI]: 'Hindi',
  [SUPPORTED_LANGUAGES.TE]: 'Telugu',
};

/**
 * A field in each language the author filled in. `partialRecord`, not `record`:
 * every language is optional at the schema level and English is required by
 * `validateQuestion`, which can say so per field instead of per object.
 * An unknown key is refused here — that is the language check.
 */
export const localizedTextSchema = z.partialRecord(languageSchema, z.string());
export type LocalizedText = z.infer<typeof localizedTextSchema>;

// ============================================================================
// Enums — mirrored from prisma/schema.prisma. A value added there is added here.
// ============================================================================

export const QUESTION_TYPE = {
  SINGLE_MCQ: 'SINGLE_MCQ',
  /** Typed answer, scored by comparison rather than by option — no options at all. */
  TEXT_FIELD: 'TEXT_FIELD',
} as const;
export const questionTypeSchema = z.enum(QUESTION_TYPE);
export type QuestionType = z.infer<typeof questionTypeSchema>;
export const QUESTION_TYPES = questionTypeSchema.options;

export const DIFFICULTY_LEVEL = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
} as const;
export const difficultyLevelSchema = z.enum(DIFFICULTY_LEVEL);
export type DifficultyLevel = z.infer<typeof difficultyLevelSchema>;
export const DIFFICULTY_LEVELS = difficultyLevelSchema.options;

export const QUESTION_STATUS = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;
export const questionStatusSchema = z.enum(QUESTION_STATUS);
export type QuestionStatus = z.infer<typeof questionStatusSchema>;
export const QUESTION_STATUSES = questionStatusSchema.options;

/**
 * How a typed answer is compared. EXACT is text, folded for case and spacing;
 * NUMERIC parses both sides as numbers and allows `tolerance` either way, which
 * is what a question answered "3.14" and marked "3.1416" needs.
 */
export const ANSWER_MODE = {
  EXACT: 'EXACT',
  NUMERIC: 'NUMERIC',
} as const;
export const answerModeSchema = z.enum(ANSWER_MODE);
export type AnswerMode = z.infer<typeof answerModeSchema>;
export const ANSWER_MODES = answerModeSchema.options;

// ============================================================================
// Content. Stored as nodes rather than a string so an image or an equation is a
// node type later, not a parser that has to guess what a string meant.
// ============================================================================

export const CONTENT_NODE_TYPE = {
  TEXT: 'TEXT',
} as const;

export const contentNodeSchema = z.object({
  type: z.literal(CONTENT_NODE_TYPE.TEXT),
  text: z.string(),
});
export type ContentNode = z.infer<typeof contentNodeSchema>;

/** One field — a stem, a solution, an option — in one language. */
export const richContentSchema = z.array(contentNodeSchema);
export type RichContent = z.infer<typeof richContentSchema>;

/** The text of a field, for searching, hashing and a one-line preview. */
export function plainTextOf(content: RichContent | undefined): string {
  if (!content) return '';
  return content
    .map((node) => node.text)
    .join(' ')
    .trim();
}

export const questionContentSchema = z.object({
  stem: richContentSchema,
  solution: richContentSchema.optional(),
});
export type QuestionContent = z.infer<typeof questionContentSchema>;

/** `Question.content` on the wire: one entry per language the author filled in. */
export const localizedContentSchema = z.partialRecord(languageSchema, questionContentSchema);
export type LocalizedContent = z.infer<typeof localizedContentSchema>;

/** `QuestionOption.text` on the wire. */
export const localizedRichSchema = z.partialRecord(languageSchema, richContentSchema);
export type LocalizedRich = z.infer<typeof localizedRichSchema>;

// ============================================================================
// Taxonomy: Subject -> Topic -> SubTopic. Names are canonical, like branches and
// groups, so "Percentages" and "PERCENTAGES " cannot both exist — a second row
// would split the per-sub-topic analytics the sharing exists to join up.
// ============================================================================

export const SUBJECT_NAME_MAX = 80;
export const TOPIC_NAME_MAX = 100;
export const SUB_TOPIC_NAME_MAX = 100;

export const subjectNameSchema = canonicalNameSchema({ max: SUBJECT_NAME_MAX, label: 'subject' });
export const topicNameSchema = canonicalNameSchema({ max: TOPIC_NAME_MAX, label: 'topic' });
export const subTopicNameSchema = canonicalNameSchema({
  max: SUB_TOPIC_NAME_MAX,
  label: 'sub-topic',
});

/** A short code an institute already uses for a subject — QA, GA, ENG. */
export const subjectCodeSchema = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .pipe(
    z
      .string()
      .max(16)
      .regex(/^[A-Z0-9]+$/, 'Use capital letters and numbers only'),
  );

/** Enough to name any taxonomy row where the screen already knows what it is. */
export const taxonomyRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type TaxonomyRef = z.infer<typeof taxonomyRefSchema>;

export const subjectRefSchema = taxonomyRefSchema;

export const subjectSchema = subjectRefSchema.extend({
  code: z.string().nullable(),
  topicCount: z.number().int(),
  questionCount: z.number().int(),
});
export type Subject = z.infer<typeof subjectSchema>;

export const topicRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  subject: subjectRefSchema,
});
export type TopicRef = z.infer<typeof topicRefSchema>;

export const topicSchema = topicRefSchema.extend({
  subTopicCount: z.number().int(),
  questionCount: z.number().int(),
});
export type Topic = z.infer<typeof topicSchema>;

export const subTopicRefSchema = taxonomyRefSchema;

/** A sub-topic is SHARED: it lists the topics it is linked to, in no one subject. */
export const subTopicSchema = subTopicRefSchema.extend({
  topics: z.array(topicRefSchema),
  questionCount: z.number().int(),
});
export type SubTopic = z.infer<typeof subTopicSchema>;

export const createSubjectSchema = z.object({
  name: subjectNameSchema,
  code: subjectCodeSchema.optional(),
});
export type CreateSubjectInput = z.input<typeof createSubjectSchema>;
export type CreateSubjectBody = z.infer<typeof createSubjectSchema>;

export const updateSubjectSchema = z.object({
  name: subjectNameSchema.optional(),
  code: subjectCodeSchema.nullable().optional(),
});
export type UpdateSubjectInput = z.input<typeof updateSubjectSchema>;
export type UpdateSubjectBody = z.infer<typeof updateSubjectSchema>;

export const createTopicSchema = z.object({
  subjectId: z.string().min(1, 'Choose a subject'),
  name: topicNameSchema,
});
export type CreateTopicInput = z.input<typeof createTopicSchema>;
export type CreateTopicBody = z.infer<typeof createTopicSchema>;

/** A topic never moves subject — the questions under it would change meaning. */
export const updateTopicSchema = z.object({
  name: topicNameSchema,
});
export type UpdateTopicInput = z.input<typeof updateTopicSchema>;
export type UpdateTopicBody = z.infer<typeof updateTopicSchema>;

/**
 * Creating a sub-topic is really "link this name to this topic": the name is
 * unique table-wide, so an existing row is reused rather than duplicated.
 */
export const createSubTopicSchema = z.object({
  name: subTopicNameSchema,
  topicIds: z.array(z.string()).min(1, 'Choose at least one topic'),
});
export type CreateSubTopicInput = z.input<typeof createSubTopicSchema>;
export type CreateSubTopicBody = z.infer<typeof createSubTopicSchema>;

/** `topicIds` REPLACES the links when present — the screen holds the whole set. */
export const updateSubTopicSchema = z.object({
  name: subTopicNameSchema.optional(),
  topicIds: z.array(z.string()).min(1, 'Choose at least one topic').optional(),
});
export type UpdateSubTopicInput = z.input<typeof updateSubTopicSchema>;
export type UpdateSubTopicBody = z.infer<typeof updateSubTopicSchema>;

export const subjectListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
});
export type SubjectListQuery = z.infer<typeof subjectListQuerySchema>;
export type SubjectListQueryInput = z.input<typeof subjectListQuerySchema>;

export const topicListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
  subjectId: z.string().optional(),
});
export type TopicListQuery = z.infer<typeof topicListQuerySchema>;
export type TopicListQueryInput = z.input<typeof topicListQuerySchema>;

export const subTopicListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
  topicId: z.string().optional(),
  /** Every sub-topic reachable from a subject — through its topics, the only route there is. */
  subjectId: z.string().optional(),
});
export type SubTopicListQuery = z.infer<typeof subTopicListQuerySchema>;
export type SubTopicListQueryInput = z.input<typeof subTopicListQuerySchema>;

// ============================================================================
// The ONE question input. The form posts it and the importer builds one per row,
// so `validateQuestion` has a single shape to judge and there is one definition
// of what a valid question is. Plain text in, content nodes out: `buildContent`
// on the server is the only place a node is constructed.
// ============================================================================

/** Four options, as every government CBT paper prints them. */
export const MCQ_OPTION_COUNT = 4;

export const MARKS_MAX = 999.99;

/** Marks are Decimal(6,2) in the database; more than two places is not a mark. */
export const questionMarksSchema = z.coerce
  .number()
  .min(0, 'Marks cannot be negative')
  .max(MARKS_MAX)
  // Compared against the rounded value rather than `Number.isInteger(value * 100)`:
  // 0.07 * 100 is 7.000000000000001 in binary, and a real mark would be refused.
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
    'Use at most two decimal places',
  );

export const TAG_MAX_LENGTH = 32;
export const TAGS_MAX = 10;

/** Lowercased so `SSC` and `ssc` are one tag, not two facets of the same filter. */
export const tagSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(2)
      .max(TAG_MAX_LENGTH)
      .regex(/^[a-z0-9]+( [a-z0-9]+)*$/, 'Use letters, numbers and single spaces only'),
  );

export const QUESTION_CODE_MAX = 64;

/** The institute's own reference for a question, where it has one. Unique across the bank. */
export const questionCodeSchema = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .pipe(
    z
      .string()
      .max(QUESTION_CODE_MAX)
      .regex(/^[A-Z0-9][A-Z0-9._/-]*$/, 'Use letters, numbers and . _ - / only'),
  );

export const questionOptionDraftSchema = z.object({
  /** 1-based authored slot. It survives shuffling and editing; correctness is keyed to it. */
  position: z.number().int().min(1).max(MCQ_OPTION_COUNT),
  isCorrect: z.boolean(),
  text: localizedTextSchema,
});
export type QuestionOptionDraft = z.infer<typeof questionOptionDraftSchema>;

/** TEXT_FIELD only: what a typed answer is compared against. */
export const answerKeyDraftSchema = z.object({
  mode: answerModeSchema,
  /** The accepted answer per language. English is required, like every other field. */
  answers: localizedTextSchema,
  /** NUMERIC only: how far either side of the answer still counts. */
  tolerance: z.coerce.number().min(0).max(MARKS_MAX).optional(),
});
export type AnswerKeyDraft = z.infer<typeof answerKeyDraftSchema>;

export const questionDraftSchema = z.object({
  type: questionTypeSchema.default(QUESTION_TYPE.SINGLE_MCQ),
  subjectId: z.string().min(1, 'Choose a subject'),
  topicId: z.string().nullable().optional(),
  subTopicId: z.string().nullable().optional(),
  difficulty: difficultyLevelSchema,
  status: questionStatusSchema.default(QUESTION_STATUS.ACTIVE),
  questionCode: questionCodeSchema.nullable().optional(),
  stem: localizedTextSchema,
  solution: localizedTextSchema.optional(),
  options: z.array(questionOptionDraftSchema).max(MCQ_OPTION_COUNT).default([]),
  answerKey: answerKeyDraftSchema.nullable().optional(),
  defaultMarks: questionMarksSchema.nullable().optional(),
  defaultNegativeMarks: questionMarksSchema.nullable().optional(),
  tags: z.array(tagSchema).max(TAGS_MAX).default([]),
});
export type QuestionDraft = z.infer<typeof questionDraftSchema>;
export type QuestionDraftInput = z.input<typeof questionDraftSchema>;

// ============================================================================
// Validation. One code vocabulary for both entry paths: the form maps a code to
// a field and the import preview prints it against a line. React to `code`.
// ============================================================================

export const QUESTION_VALIDATION_CODE = {
  ENGLISH_STEM_REQUIRED: 'ENGLISH_STEM_REQUIRED',
  UNSUPPORTED_LANGUAGE: 'UNSUPPORTED_LANGUAGE',
  /** A Hindi or Telugu option filled in where that language has no stem. */
  TRANSLATION_WITHOUT_STEM: 'TRANSLATION_WITHOUT_STEM',
  OPTION_COUNT_INVALID: 'OPTION_COUNT_INVALID',
  OPTION_TEXT_REQUIRED: 'OPTION_TEXT_REQUIRED',
  OPTION_TEXT_DUPLICATE: 'OPTION_TEXT_DUPLICATE',
  CORRECT_OPTION_REQUIRED: 'CORRECT_OPTION_REQUIRED',
  CORRECT_OPTION_INVALID: 'CORRECT_OPTION_INVALID',
  OPTIONS_NOT_ALLOWED: 'OPTIONS_NOT_ALLOWED',
  ANSWER_REQUIRED: 'ANSWER_REQUIRED',
  ANSWER_NOT_ALLOWED: 'ANSWER_NOT_ALLOWED',
  ANSWER_MODE_INVALID: 'ANSWER_MODE_INVALID',
  ANSWER_NOT_NUMERIC: 'ANSWER_NOT_NUMERIC',
  TOLERANCE_NOT_ALLOWED: 'TOLERANCE_NOT_ALLOWED',
  SUBJECT_REQUIRED: 'SUBJECT_REQUIRED',
  SUBJECT_UNKNOWN: 'SUBJECT_UNKNOWN',
  TOPIC_UNKNOWN: 'TOPIC_UNKNOWN',
  TOPIC_NOT_IN_SUBJECT: 'TOPIC_NOT_IN_SUBJECT',
  SUB_TOPIC_UNKNOWN: 'SUB_TOPIC_UNKNOWN',
  SUB_TOPIC_NEEDS_TOPIC: 'SUB_TOPIC_NEEDS_TOPIC',
  SUB_TOPIC_NOT_IN_TOPIC: 'SUB_TOPIC_NOT_IN_TOPIC',
  DIFFICULTY_INVALID: 'DIFFICULTY_INVALID',
  TYPE_INVALID: 'TYPE_INVALID',
  STATUS_INVALID: 'STATUS_INVALID',
  MARKS_INVALID: 'MARKS_INVALID',
  TAG_INVALID: 'TAG_INVALID',
  QUESTION_CODE_INVALID: 'QUESTION_CODE_INVALID',
  QUESTION_CODE_TAKEN: 'QUESTION_CODE_TAKEN',
  /** The same stem appears earlier in this very file. */
  DUPLICATE_IN_FILE: 'DUPLICATE_IN_FILE',
  /** The same stem is already in the bank. */
  DUPLICATE_IN_BANK: 'DUPLICATE_IN_BANK',
} as const;
export const questionValidationCodeSchema = z.enum(QUESTION_VALIDATION_CODE);
export type QuestionValidationCode = z.infer<typeof questionValidationCodeSchema>;

/**
 * One problem with one question. `field` is the draft path the form focuses
 * (`stem.en`, `options.2.text.hi`); `column` is what the sheet calls the same
 * thing, so the import preview names a header the admin can see.
 */
export const validationIssueSchema = z.object({
  code: questionValidationCodeSchema,
  message: z.string(),
  field: z.string().optional(),
  column: z.string().optional(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

// ============================================================================
// Questions, as the admin reads them back
// ============================================================================

export const questionOptionSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  isCorrect: z.boolean(),
  text: localizedRichSchema,
});
export type QuestionOption = z.infer<typeof questionOptionSchema>;

export const answerKeySchema = z.object({
  mode: answerModeSchema,
  answers: localizedTextSchema,
  tolerance: z.number().nullable().optional(),
});
export type AnswerKey = z.infer<typeof answerKeySchema>;

/** Where a question came from. Stamped by the server; never sent by a client. */
export const QUESTION_SOURCE_KIND = {
  MANUAL: 'MANUAL',
  IMPORT: 'IMPORT',
} as const;
export const questionSourceSchema = z.object({
  kind: z.enum(QUESTION_SOURCE_KIND),
  importLogId: z.string().optional(),
  /** The line in the uploaded sheet — the answer to "where did this come from". */
  line: z.number().int().optional(),
});
export type QuestionSource = z.infer<typeof questionSourceSchema>;

export const questionSummarySchema = z.object({
  id: z.string(),
  questionCode: z.string().nullable(),
  type: questionTypeSchema,
  difficulty: difficultyLevelSchema,
  status: questionStatusSchema,
  isActive: z.boolean(),
  subject: taxonomyRefSchema,
  topic: taxonomyRefSchema.nullable(),
  subTopic: taxonomyRefSchema.nullable(),
  /** The English stem, flattened — what a list row shows without loading the content. */
  stemPreview: z.string(),
  /** Which languages this question has been authored in, in `LANGUAGE_ORDER`. */
  languages: z.array(languageSchema),
  tags: z.array(z.string()),
  updatedAt: z.string(),
});
export type QuestionSummary = z.infer<typeof questionSummarySchema>;

export const questionDetailSchema = questionSummarySchema.extend({
  content: localizedContentSchema,
  options: z.array(questionOptionSchema),
  answerKey: answerKeySchema.nullable(),
  defaultMarks: z.number().nullable(),
  defaultNegativeMarks: z.number().nullable(),
  source: questionSourceSchema.nullable(),
  createdAt: z.string(),
});
export type QuestionDetail = z.infer<typeof questionDetailSchema>;

export const QUESTION_SORTS = {
  RECENT: 'recent',
  OLDEST: 'oldest',
} as const;
export type QuestionSort = (typeof QUESTION_SORTS)[keyof typeof QUESTION_SORTS];
export const QUESTION_SORT_VALUES = Object.values(QUESTION_SORTS) as [
  QuestionSort,
  ...QuestionSort[],
];

export const questionListQuerySchema = paginationQuerySchema.extend({
  /** Matches the stem in any language, and the question code. */
  q: searchQuery(),
  subjectId: z.string().optional(),
  topicId: z.string().optional(),
  subTopicId: z.string().optional(),
  type: questionTypeSchema.optional(),
  difficulty: difficultyLevelSchema.optional(),
  status: questionStatusSchema.optional(),
  isActive: optionalBooleanQuery(),
  language: languageSchema.optional(),
  tag: tagSchema.optional(),
  sort: z.enum(QUESTION_SORT_VALUES).optional().default(QUESTION_SORTS.RECENT),
});
export type QuestionListQuery = z.infer<typeof questionListQuerySchema>;
export type QuestionListQueryInput = z.input<typeof questionListQuerySchema>;

/**
 * Retiring a question rather than deleting it: an inactive question is hidden
 * from the bank and drawn into no future paper, while every paper that already
 * holds it is untouched.
 */
export const setQuestionActiveSchema = z.object({
  isActive: z.boolean(),
});
export type SetQuestionActiveInput = z.input<typeof setQuestionActiveSchema>;
export type SetQuestionActiveBody = z.infer<typeof setQuestionActiveSchema>;

export const setQuestionStatusSchema = z.object({
  status: questionStatusSchema,
});
export type SetQuestionStatusInput = z.input<typeof setQuestionStatusSchema>;
export type SetQuestionStatusBody = z.infer<typeof setQuestionStatusSchema>;

// ============================================================================
// The import sheet. These columns are the ONE definition of the format: the
// template is generated from them and the parser matches on them, so the sample
// cannot document a format the importer will not accept.
// ============================================================================

const languageColumn = (
  key: string,
  header: string,
  width: number,
  language: QuestionLanguage,
  required = false,
) => ({ key, header, width, required, language, aliases: [header.replaceAll('_', '')] }) as const;

export const QUESTION_IMPORT_COLUMNS = [
  { key: 'type', header: 'type', width: 14, required: false, aliases: ['type', 'questiontype'] },
  { key: 'subject', header: 'subject', width: 22, required: true, aliases: ['subject'] },
  { key: 'topic', header: 'topic', width: 22, required: false, aliases: ['topic'] },
  {
    key: 'subtopic',
    header: 'subtopic',
    width: 22,
    required: false,
    aliases: ['subtopic', 'subtopicname'],
  },
  {
    key: 'difficulty',
    header: 'difficulty',
    width: 12,
    required: true,
    aliases: ['difficulty', 'level'],
  },
  languageColumn('stem_en', 'stem_en', 60, SUPPORTED_LANGUAGES.EN, true),
  languageColumn('stem_hi', 'stem_hi', 60, SUPPORTED_LANGUAGES.HI),
  languageColumn('stem_te', 'stem_te', 60, SUPPORTED_LANGUAGES.TE),
  languageColumn('option1_en', 'option1_en', 28, SUPPORTED_LANGUAGES.EN),
  languageColumn('option2_en', 'option2_en', 28, SUPPORTED_LANGUAGES.EN),
  languageColumn('option3_en', 'option3_en', 28, SUPPORTED_LANGUAGES.EN),
  languageColumn('option4_en', 'option4_en', 28, SUPPORTED_LANGUAGES.EN),
  languageColumn('option1_hi', 'option1_hi', 28, SUPPORTED_LANGUAGES.HI),
  languageColumn('option2_hi', 'option2_hi', 28, SUPPORTED_LANGUAGES.HI),
  languageColumn('option3_hi', 'option3_hi', 28, SUPPORTED_LANGUAGES.HI),
  languageColumn('option4_hi', 'option4_hi', 28, SUPPORTED_LANGUAGES.HI),
  languageColumn('option1_te', 'option1_te', 28, SUPPORTED_LANGUAGES.TE),
  languageColumn('option2_te', 'option2_te', 28, SUPPORTED_LANGUAGES.TE),
  languageColumn('option3_te', 'option3_te', 28, SUPPORTED_LANGUAGES.TE),
  languageColumn('option4_te', 'option4_te', 28, SUPPORTED_LANGUAGES.TE),
  {
    key: 'correct_option',
    header: 'correct_option',
    width: 16,
    required: false,
    aliases: ['correctoption', 'answerkey', 'correct'],
  },
  {
    key: 'answer_mode',
    header: 'answer_mode',
    width: 14,
    required: false,
    aliases: ['answermode'],
  },
  languageColumn('answer_en', 'answer_en', 24, SUPPORTED_LANGUAGES.EN),
  languageColumn('answer_hi', 'answer_hi', 24, SUPPORTED_LANGUAGES.HI),
  languageColumn('answer_te', 'answer_te', 24, SUPPORTED_LANGUAGES.TE),
  {
    key: 'answer_tolerance',
    header: 'answer_tolerance',
    width: 16,
    required: false,
    aliases: ['answertolerance', 'tolerance'],
  },
  languageColumn('solution_en', 'solution_en', 60, SUPPORTED_LANGUAGES.EN),
  languageColumn('solution_hi', 'solution_hi', 60, SUPPORTED_LANGUAGES.HI),
  languageColumn('solution_te', 'solution_te', 60, SUPPORTED_LANGUAGES.TE),
  { key: 'marks', header: 'marks', width: 10, required: false, aliases: ['marks', 'mark'] },
  {
    key: 'negative_marks',
    header: 'negative_marks',
    width: 15,
    required: false,
    aliases: ['negativemarks', 'negmarks', 'penalty'],
  },
  { key: 'tags', header: 'tags', width: 30, required: false, aliases: ['tags', 'tag'] },
  {
    key: 'question_code',
    header: 'question_code',
    width: 18,
    required: false,
    aliases: ['questioncode', 'code', 'qcode'],
  },
] as const;

export type QuestionImportColumn = (typeof QUESTION_IMPORT_COLUMNS)[number];
export type QuestionImportColumnKey = QuestionImportColumn['key'];

export const QUESTION_IMPORT_TEMPLATE_FILENAME = 'iace-questions-template.xlsx';

/** The sheet the rows are read from. The taxonomy lists live on their own tab. */
export const QUESTION_IMPORT_SHEETS = {
  QUESTIONS: 'Questions',
  INSTRUCTIONS: 'Instructions',
  LISTS: 'Lists',
} as const;

/** Bounded so one upload stays a single synchronous request. */
export const QUESTION_IMPORT_MAX_ROWS = 1000;

/** Several tags in one cell. */
export const TAG_SEPARATOR = ',';

/**
 * `create` writes the row. `duplicate` is a stem already in the bank or earlier
 * in this file — skipped, and not an error worth blocking the upload for.
 * `skip` has issues.
 */
export const questionImportActionSchema = z.enum(['create', 'duplicate', 'skip']);
export type QuestionImportAction = z.infer<typeof questionImportActionSchema>;

export const questionImportRowSchema = z.object({
  /** 1-based line in the uploaded file, header included, as Excel shows it. */
  line: z.number().int(),
  action: questionImportActionSchema,
  /** The English stem, shortened — enough to recognise the row in the preview. */
  stemPreview: z.string(),
  subjectName: z.string().nullable(),
  topicName: z.string().nullable(),
  subTopicName: z.string().nullable(),
  languages: z.array(languageSchema),
  issues: z.array(validationIssueSchema),
  /** The question this row repeats: an id from the bank, or a line in this file. */
  duplicateOf: z.string().nullable(),
});
export type QuestionImportRow = z.infer<typeof questionImportRowSchema>;

export const questionImportSummarySchema = z.object({
  total: z.number().int(),
  willCreate: z.number().int(),
  duplicates: z.number().int(),
  invalid: z.number().int(),
});
export type QuestionImportSummary = z.infer<typeof questionImportSummarySchema>;

export const questionImportPlanSchema = z.object({
  /** The run this preview opened. Commit names it rather than re-uploading the file. */
  importLogId: z.string(),
  rows: z.array(questionImportRowSchema),
  summary: questionImportSummarySchema,
  /** Wrong with the FILE rather than a row — a missing column, an empty upload. */
  fileErrors: z.array(z.string()),
});
export type QuestionImportPlan = z.infer<typeof questionImportPlanSchema>;

export const questionImportCommitSchema = z.object({
  importLogId: z.string().min(1),
});
export type QuestionImportCommitInput = z.input<typeof questionImportCommitSchema>;
export type QuestionImportCommitBody = z.infer<typeof questionImportCommitSchema>;

export const questionImportResultSchema = questionImportSummarySchema.extend({
  created: z.number().int(),
  skipped: z.number().int(),
});
export type QuestionImportResult = z.infer<typeof questionImportResultSchema>;

// ============================================================================
// Routes
// ============================================================================

export const ADMIN_TAXONOMY_ROUTES = {
  subjects: '/admin/subjects',
  subject: (id: string) => `/admin/subjects/${id}`,
  topics: '/admin/topics',
  topic: (id: string) => `/admin/topics/${id}`,
  subTopics: '/admin/sub-topics',
  subTopic: (id: string) => `/admin/sub-topics/${id}`,
} as const;

export const ADMIN_QUESTION_ROUTES = {
  list: '/admin/questions',
  create: '/admin/questions',
  get: (id: string) => `/admin/questions/${id}`,
  update: (id: string) => `/admin/questions/${id}`,
  setActive: (id: string) => `/admin/questions/${id}/active`,
  setStatus: (id: string) => `/admin/questions/${id}/status`,
} as const;

/**
 * Under /imports, which is the one path with the larger body limit — see
 * apps/api/src/common/body-parsers.ts.
 */
export const QUESTION_IMPORT_ROUTES = {
  template: '/imports/questions/template',
  preview: '/imports/questions/preview',
  commit: '/imports/questions/commit',
} as const;
