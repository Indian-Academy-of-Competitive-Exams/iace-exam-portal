import { z } from 'zod';
import { csvIdQuery, csvQuery, matchModeQuery, searchQuery } from './common';
import { dateOnlySchema } from './students';
import { paginationQuerySchema } from './envelope';
import {
  languageSchema,
  localizedContentSchema,
  localizedRichSchema,
  localizedTextSchema,
} from './question-content';
import { taxonomyRefSchema } from './question-taxonomy';

// ============================================================================
// The question bank: the taxonomy a question hangs off, the ONE input shape both
// the single-question form and the importer post, and the preview that importer
// answers with. A question is multilingual — English always, Hindi and Telugu
// when the institute has them.
// ============================================================================

// ============================================================================
// Enums — mirrored from prisma/schema.prisma. A value added there is added here.
// ============================================================================

export const QUESTION_TYPE = {
  SINGLE_MCQ: 'SINGLE_MCQ',
  /** Typed answer, scored by comparison rather than by option — no options at all. */
  TEXT_FIELD: 'TEXT_FIELD',
  /** A passage to be typed: the stem is the passage, with no options and no answer key. */
  TYPING: 'TYPING',
  /** An essay, a letter or a précis: written free, and marked by rule against the key points its author named. */
  DESCRIPTIVE: 'DESCRIPTIVE',
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

export const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  [DIFFICULTY_LEVEL.LOW]: 'Low',
  [DIFFICULTY_LEVEL.MEDIUM]: 'Medium',
  [DIFFICULTY_LEVEL.HIGH]: 'High',
};

export const QUESTION_STATUS = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;
export const questionStatusSchema = z.enum(QUESTION_STATUS);
export type QuestionStatus = z.infer<typeof questionStatusSchema>;
export const QUESTION_STATUSES = questionStatusSchema.options;

/** How a typed answer is compared: EXACT is text folded for case and spacing; NUMERIC parses both sides as numbers and allows `tolerance` either way. */
export const ANSWER_MODE = {
  EXACT: 'EXACT',
  NUMERIC: 'NUMERIC',
} as const;
const answerModeSchema = z.enum(ANSWER_MODE);
export type AnswerMode = z.infer<typeof answerModeSchema>;
export const ANSWER_MODES = answerModeSchema.options;

// ============================================================================
// The ONE question input. The form posts it and the importer builds one per row,
// so `validateQuestion` has a single shape to judge and there is one definition
// of what a valid question is. Plain text in, content nodes out: `buildContent`
// on the server is the only place a node is constructed.
// ============================================================================

/** Four options, as most government CBT papers print them — the count a new question opens with. */
export const MCQ_OPTION_COUNT = 4;

/** The range a paper can actually print: SBI PO runs A\u2013E, and nothing here goes past F. */
export const MCQ_OPTION_MIN = 2;
export const MCQ_OPTION_MAX = 6;

const MARKS_MAX = 999.99;

/** How far either side of a numeric answer still counts: a mark-sized number, judged alike by the form, the sheet and the save. */
export const toleranceSchema = z.number().min(0).max(MARKS_MAX);

/** Marks are Decimal(6,2) in the database; more than two places is not a mark. Used by a base config's sections, and by an answer tolerance. */
export const questionMarksSchema = z.coerce
  .number()
  .min(0, 'Marks cannot be negative')
  .max(MARKS_MAX)
  // Compared against the rounded value rather than `Number.isInteger(value * 100)`: 0.07 * 100 is 7.000000000000001 in binary.
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
    'Use at most two decimal places',
  );

const TAG_MAX_LENGTH = 32;
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

const QUESTION_CODE_MAX = 64;

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

const questionOptionDraftSchema = z.object({
  /** 1-based authored slot. It survives shuffling and editing; correctness is keyed to it. */
  position: z.number().int().min(1).max(MCQ_OPTION_MAX),
  isCorrect: z.boolean(),
  text: localizedTextSchema,
});

/** What a piece of writing is, which decides the parts its format is checked for. */
export const WRITING_FORMAT = {
  ESSAY: 'ESSAY',
  LETTER: 'LETTER',
  PRECIS: 'PRECIS',
  OTHER: 'OTHER',
} as const;
export const writingFormatSchema = z.enum(WRITING_FORMAT);
export type WritingFormat = z.infer<typeof writingFormatSchema>;
export const WRITING_FORMATS = writingFormatSchema.options;

export const WRITING_WORDS_MAX = 2000;
export const wordLimitSchema = z.number().int().min(1).max(WRITING_WORDS_MAX);

/** DESCRIPTIVE only: the format and the word limits an answer is held to. Its key points are the key's `answers`. */
export const writingRubricSchema = z.object({
  format: writingFormatSchema,
  minWords: wordLimitSchema.nullish(),
  maxWords: wordLimitSchema.nullish(),
});
export type WritingRubric = z.infer<typeof writingRubricSchema>;

/** What a typed answer is compared against: a TEXT_FIELD's accepted answer, or a DESCRIPTIVE's key points, one a line. */
const answerKeyDraftSchema = z.object({
  mode: answerModeSchema,
  /** The accepted answer per language. English is required, like every other field. */
  answers: localizedTextSchema,
  /** NUMERIC only: how far either side of the answer still counts. */
  tolerance: toleranceSchema.optional(),
  rubric: writingRubricSchema.optional(),
});
export type AnswerKeyDraft = z.infer<typeof answerKeyDraftSchema>;

export const questionDraftSchema = z.object({
  type: questionTypeSchema.default(QUESTION_TYPE.SINGLE_MCQ),
  subjectId: z.string().min(1, 'Choose a subject'),
  topicId: z.string().nullable().optional(),
  difficulty: difficultyLevelSchema,
  questionCode: questionCodeSchema.nullable().optional(),
  stem: localizedTextSchema,
  /** Carried by every question it belongs to: there is no grouping, so each holds its own copy. */
  passage: localizedTextSchema.optional(),
  solution: localizedTextSchema.optional(),
  options: z.array(questionOptionDraftSchema).max(MCQ_OPTION_MAX).default([]),
  answerKey: answerKeyDraftSchema.nullable().optional(),
  tags: z
    .array(tagSchema)
    .overwrite((tags) => [...new Set(tags)])
    .max(TAGS_MAX)
    .default([]),
  /** The `updatedAt` the editor loaded. Sent, it refuses a save built on a stale screen. */
  expectedUpdatedAt: z.string().optional(),
});
export type QuestionDraft = z.infer<typeof questionDraftSchema>;
export type QuestionDraftInput = z.input<typeof questionDraftSchema>;

/** What a question's identity is read from — all a stored version still has once the draft is gone. */
export const questionIdentitySchema = questionDraftSchema
  .pick({ type: true, stem: true, passage: true, options: true })
  .extend({ answerKey: answerKeyDraftSchema.pick({ answers: true }).nullable().optional() });
export type QuestionIdentity = z.infer<typeof questionIdentitySchema>;

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
  /** A formula that will not render — a candidate would meet it as red error text mid-test. */
  MATH_INVALID: 'MATH_INVALID',
  TOLERANCE_NOT_ALLOWED: 'TOLERANCE_NOT_ALLOWED',
  /** A typing passage carrying a picture or a formula, which no keyboard types. */
  TYPING_PASSAGE_NOT_PLAIN: 'TYPING_PASSAGE_NOT_PLAIN',
  /** A typing passage shorter than any standard could use. */
  TYPING_PASSAGE_TOO_SHORT: 'TYPING_PASSAGE_TOO_SHORT',
  TYPING_PASSAGE_TOO_LONG: 'TYPING_PASSAGE_TOO_LONG',
  /** A descriptive question whose word limit is not a whole number in range, or whose lower limit is above its upper one. */
  WORD_LIMIT_INVALID: 'WORD_LIMIT_INVALID',
  SUBJECT_REQUIRED: 'SUBJECT_REQUIRED',
  SUBJECT_UNKNOWN: 'SUBJECT_UNKNOWN',
  TOPIC_UNKNOWN: 'TOPIC_UNKNOWN',
  TOPIC_NOT_IN_SUBJECT: 'TOPIC_NOT_IN_SUBJECT',
  DIFFICULTY_INVALID: 'DIFFICULTY_INVALID',
  TYPE_INVALID: 'TYPE_INVALID',
  STATUS_INVALID: 'STATUS_INVALID',
  TAG_INVALID: 'TAG_INVALID',
  QUESTION_CODE_INVALID: 'QUESTION_CODE_INVALID',
  QUESTION_CODE_TAKEN: 'QUESTION_CODE_TAKEN',
  /** A picture placed over a sheet cell that is not an image we can store, or over a cell that takes none. */
  PICTURE_INVALID: 'PICTURE_INVALID',
  /** The same stem appears earlier in this very file. */
  DUPLICATE_IN_FILE: 'DUPLICATE_IN_FILE',
  /** The same stem is already in the bank. */
  DUPLICATE_IN_BANK: 'DUPLICATE_IN_BANK',
  /** A sheet imported into one section of a test, with a row filed under a subject the section does not take. */
  SUBJECT_OUTSIDE_SECTION: 'SUBJECT_OUTSIDE_SECTION',
  /** The same, by kind: a typing section takes typing passages, and no other section takes one. */
  TYPE_OUTSIDE_SECTION: 'TYPE_OUTSIDE_SECTION',
  /** A question of a language subject (Hindi Comprehension) with no text in that language. */
  SUBJECT_LANGUAGE_REQUIRED: 'SUBJECT_LANGUAGE_REQUIRED',
  /** A question of a language subject carrying any other language: it tests that language alone. */
  LANGUAGE_OUTSIDE_SUBJECT: 'LANGUAGE_OUTSIDE_SUBJECT',
  /** A whole-test sheet's row naming no section of the test, or one that is not there. */
  SECTION_UNKNOWN: 'SECTION_UNKNOWN',
  /** A whole-test sheet's row for a section with no typist to hold it, or one already done. */
  SECTION_NOT_OPEN: 'SECTION_NOT_OPEN',
  /** A whole-test sheet's row past the room its section has left; discarded, never saved. */
  SECTION_FULL: 'SECTION_FULL',
} as const;
const questionValidationCodeSchema = z.enum(QUESTION_VALIDATION_CODE);

/** Found only by reading a sheet or by where its row is going, so an editor's own checklist never raises them. */
export const SHEET_ONLY_VALIDATION_CODES: ReadonlySet<string> = new Set([
  QUESTION_VALIDATION_CODE.TYPE_INVALID,
  QUESTION_VALIDATION_CODE.DIFFICULTY_INVALID,
  QUESTION_VALIDATION_CODE.TAG_INVALID,
  QUESTION_VALIDATION_CODE.QUESTION_CODE_INVALID,
  QUESTION_VALIDATION_CODE.QUESTION_CODE_TAKEN,
  QUESTION_VALIDATION_CODE.PICTURE_INVALID,
  QUESTION_VALIDATION_CODE.SUBJECT_UNKNOWN,
  QUESTION_VALIDATION_CODE.TOPIC_UNKNOWN,
  QUESTION_VALIDATION_CODE.SUBJECT_OUTSIDE_SECTION,
  QUESTION_VALIDATION_CODE.TYPE_OUTSIDE_SECTION,
  QUESTION_VALIDATION_CODE.SECTION_UNKNOWN,
  QUESTION_VALIDATION_CODE.SECTION_NOT_OPEN,
  QUESTION_VALIDATION_CODE.SECTION_FULL,
]);

/** One problem with one question: `field` is the draft path the form focuses (`stem.en`, `options.2.text.hi`); `column` is what the sheet calls the same thing. */
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
  rubric: writingRubricSchema.optional(),
});
export type AnswerKey = z.infer<typeof answerKeySchema>;

/** The admin a question is filed against. Name falls back to the email they sign in with. */
const questionAuthorSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const questionSummarySchema = z.object({
  id: z.string(),
  questionCode: z.string().nullable(),
  type: questionTypeSchema,
  difficulty: difficultyLevelSchema,
  status: questionStatusSchema,
  subject: taxonomyRefSchema,
  topic: taxonomyRefSchema.nullable(),
  /** The English stem, flattened — what a list row shows without loading the content. */
  stemPreview: z.string(),
  /** Which languages this question has been authored in, in `LANGUAGE_ORDER`. */
  languages: z.array(languageSchema),
  tags: z.array(z.string()),
  /** Who wrote it, resolved from the author relation. Null once nobody owns the id any more. */
  author: questionAuthorSchema.nullable(),
  /** Whether a paper, an attempt or a stat points at it — what decides if it can still be undone. */
  inUse: z.boolean(),
  /** The section it was first written for. Null for a question typed outside any assignment. */
  writtenFor: z
    .object({
      testId: z.string(),
      testTitle: z.string().nullable(),
      baseConfigSectionId: z.string(),
      sectionName: z.string(),
      /** Its test still has a job open, so the bank refuses to change it and its section's page does. */
      inProgress: z.boolean(),
    })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type QuestionSummary = z.infer<typeof questionSummarySchema>;

/** Everything below comes from the CURRENT version — a question itself carries no content. */
export const questionDetailSchema = questionSummarySchema.extend({
  /** Which version this is: 1, 2, 3… A reachable test pinning the old one gains the next. */
  version: z.number().int(),
  content: localizedContentSchema,
  options: z.array(questionOptionSchema),
  answerKey: answerKeySchema.nullable(),
  createdAt: z.string(),
});
export type QuestionDetail = z.infer<typeof questionDetailSchema>;

/** One link in a question's version chain. `createdById` has no FK, so the name is resolved server-side. */
export const questionVersionSummarySchema = z.object({
  id: z.string(),
  version: z.number().int(),
  createdAt: z.string(),
  authorName: z.string().nullable(),
  /** The tests whose paper pins this version — empty means no paper has drawn it. */
  pinnedBy: z.array(z.string()),
});
export type QuestionVersionSummary = z.infer<typeof questionVersionSummarySchema>;

export const QUESTION_SORTS = {
  RECENT: 'recent',
  OLDEST: 'oldest',
} as const;
export type QuestionSort = (typeof QUESTION_SORTS)[keyof typeof QUESTION_SORTS];
const QUESTION_SORT_VALUES = Object.values(QUESTION_SORTS) as [QuestionSort, ...QuestionSort[]];

/** The two sides of one test's pool: what its own assignments wrote, and everything else. */
export const WRITTEN_FOR = {
  TEST: 'test',
  BANK: 'bank',
} as const;
export type WrittenFor = (typeof WRITTEN_FOR)[keyof typeof WRITTEN_FOR];
const WRITTEN_FOR_VALUES = Object.values(WRITTEN_FOR) as [WrittenFor, ...WrittenFor[]];

export const questionListQuerySchema = paginationQuerySchema.extend({
  /** Matches the stem in any language, the question code, and any tag. */
  q: searchQuery(),
  subjectId: csvIdQuery(),
  topicId: csvIdQuery(),
  type: csvQuery(questionTypeSchema),
  difficulty: csvQuery(difficultyLevelSchema),
  status: csvQuery(questionStatusSchema),
  language: languageSchema.optional(),
  tag: tagSchema.optional(),
  /** Matches the author's name or the email they sign in with — there is no picker to choose from. */
  author: searchQuery(),
  /** Civil days in Asia/Kolkata, widened to the whole day by the service. */
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  /** Only what a paper may draw: not archived and carrying a version. */
  drawable: z.stringbool().optional(),
  /** The test this list is being drawn for: it may take its own in-progress work, nobody else's. */
  forTestId: z.string().optional(),
  /** The kind of section this is drawn for, which takes its own kind of question and no other. */
  forKind: z.enum(['CHOICE', 'TYPING', 'WRITING']).optional(),
  /** Which side of that split: what its assignments wrote, or the rest of the bank. */
  writtenFor: z.enum(WRITTEN_FOR_VALUES).optional(),
  sort: z.enum(QUESTION_SORT_VALUES).optional().default(QUESTION_SORTS.RECENT),
  match: matchModeQuery(),
});
export type QuestionListQuery = z.infer<typeof questionListQuerySchema>;
export type QuestionListQueryInput = z.input<typeof questionListQuerySchema>;

/** The list's own query minus the page: every matching row, in the list's order. */
export const questionExportQuerySchema = questionListQuerySchema.omit({
  page: true,
  pageSize: true,
});
export type QuestionExportQuery = z.infer<typeof questionExportQuerySchema>;
export type QuestionExportQueryInput = z.input<typeof questionExportQuerySchema>;

// ============================================================================
// Routes
// ============================================================================

/** What the bank holds for a slice of it, counted rather than paged: a page is not a total. */
export const questionAvailabilitySchema = z.object({
  total: z.number().int(),
  byDifficulty: z.partialRecord(difficultyLevelSchema, z.number().int()),
});
export type QuestionAvailability = z.infer<typeof questionAvailabilitySchema>;

export const questionAvailabilityQuerySchema = z.object({
  subjectId: csvIdQuery(),
  topicId: csvIdQuery(),
  /** Counted as the draw counts it, so the figure shown and the questions taken cannot disagree. */
  forTestId: z.string().optional(),
  forKind: z.enum(['CHOICE', 'TYPING', 'WRITING']).optional(),
});
export type QuestionAvailabilityQuery = z.infer<typeof questionAvailabilityQuerySchema>;
export type QuestionAvailabilityQueryInput = z.input<typeof questionAvailabilityQuerySchema>;

export const ADMIN_QUESTION_ROUTES = {
  list: '/admin/questions',
  availability: '/admin/questions/availability',
  create: '/admin/questions',
  get: (id: string) => `/admin/questions/${id}`,
  versions: (id: string) => `/admin/questions/${id}/versions`,
  update: (id: string) => `/admin/questions/${id}`,
  archive: (id: string) => `/admin/questions/${id}/archive`,
  unarchive: (id: string) => `/admin/questions/${id}/unarchive`,
  remove: (id: string) => `/admin/questions/${id}`,
  uploadImage: '/admin/questions/images',
  export: '/admin/questions/export',
} as const;
