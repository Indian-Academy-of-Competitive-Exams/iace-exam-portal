import { z } from 'zod';
import { csvIdQuery, csvQuery, matchModeQuery, searchQuery } from './common';
import { paginationQuerySchema } from './envelope';
import {
  difficultyLevelSchema,
  questionDetailSchema,
  questionStatusSchema,
  questionTypeSchema,
  tagSchema,
} from './questions';
import { dateOnlySchema } from './students';

// ============================================================================
// Authoring: the typist's half of the question bank. Everything here is scoped
// to the admin who wrote it — a `QUESTION_AUTHORING` grant reaches an author's
// own questions and nothing else, which is what makes it narrower than
// `QUESTION_MANAGEMENT` rather than a second name for it.
// ============================================================================

/** How far back the output chart reads. A typist's pace is a month's shape, not a year's. */
export const AUTHORING_HISTORY_DAYS = 30;

/** How many of the author's own recent tags the header offers. */
export const AUTHORING_TAG_SUGGESTIONS = 40;

export const authoringHistoryQuerySchema = paginationQuerySchema.extend({
  /** Matches the stem in any language, the question code, and any tag. */
  q: searchQuery(),
  status: csvQuery(questionStatusSchema),
  subjectId: csvIdQuery(),
  type: csvQuery(questionTypeSchema),
  difficulty: csvQuery(difficultyLevelSchema),
  tag: tagSchema.optional(),
  /** Institute days, inclusive, against when the question was written. */
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  match: matchModeQuery(),
});
export type AuthoringHistoryQuery = z.infer<typeof authoringHistoryQuerySchema>;
export type AuthoringHistoryQueryInput = z.input<typeof authoringHistoryQuerySchema>;

/** One institute day's output, so a gap in the run reads as a zero rather than as no data. */
export const authoringDaySchema = z.object({
  date: dateOnlySchema,
  count: z.number().int(),
});
export type AuthoringDay = z.infer<typeof authoringDaySchema>;

export const authoringStatsSchema = z.object({
  today: z.number().int(),
  lastSevenDays: z.number().int(),
  total: z.number().int(),
  /** Their own drafts, which is what "waiting on somebody else" looks like from here. */
  inReview: z.number().int(),
  byStatus: z.partialRecord(questionStatusSchema, z.number().int()),
  /** `AUTHORING_HISTORY_DAYS` entries ending today, every day present. */
  daily: z.array(authoringDaySchema),
});
export type AuthoringStats = z.infer<typeof authoringStatsSchema>;

/** A near-duplicate is reported and written anyway: two similar questions may both be real. */
export const authoringSaveResultSchema = z.object({
  question: questionDetailSchema,
  duplicateOf: z.object({ id: z.string(), stemPreview: z.string() }).nullable().default(null),
});
export type AuthoringSaveResult = z.infer<typeof authoringSaveResultSchema>;

export const authoringTagsSchema = z.object({ tags: z.array(z.string()) });
export type AuthoringTags = z.infer<typeof authoringTagsSchema>;

export const ADMIN_AUTHORING_ROUTES = {
  tags: '/admin/authoring/tags',
  stats: '/admin/authoring/stats',
  history: '/admin/authoring/questions',
  create: '/admin/authoring/questions',
  get: (id: string) => `/admin/authoring/questions/${id}`,
  update: (id: string) => `/admin/authoring/questions/${id}`,
} as const;
