import { z } from 'zod';
import { csvIdQuery } from './common';
import {
  questionDetailSchema,
  questionDraftSchema,
  questionListQuerySchema,
  questionStatusSchema,
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

/** The bank's own filters, over the author's own questions — `from`/`to` read when it was WRITTEN. */
export const authoringHistoryQuerySchema = questionListQuerySchema
  .pick({
    page: true,
    pageSize: true,
    q: true,
    status: true,
    subjectId: true,
    type: true,
    difficulty: true,
    tag: true,
    from: true,
    to: true,
    match: true,
  })
  .extend({
    /** The section a question was written for, which is how a typist finds one batch again. */
    assignmentId: csvIdQuery(),
    /** The test that section belongs to — every batch written for it, whichever section. */
    testId: z.string().optional(),
  });
export type AuthoringHistoryQuery = z.infer<typeof authoringHistoryQuerySchema>;
export type AuthoringHistoryQueryInput = z.input<typeof authoringHistoryQuerySchema>;

/** One institute day's output, so a gap in the run reads as a zero rather than as no data. */
const authoringDaySchema = z.object({
  date: dateOnlySchema,
  count: z.number().int(),
});

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

const duplicateRefSchema = z.object({ id: z.string(), stemPreview: z.string() }).nullable();

/** A duplicate never gets this far: the save refuses it, naming the question, as a CONFLICT. */
export const authoringSaveResultSchema = z.object({ question: questionDetailSchema });
export type AuthoringSaveResult = z.infer<typeof authoringSaveResultSchema>;

/** Asked while the question is still being typed, so the answer arrives before the Save. */
export const authoringDuplicateSchema = z.object({ duplicateOf: duplicateRefSchema });
export type AuthoringDuplicate = z.infer<typeof authoringDuplicateSchema>;

/** The draft as typed, plus the question being edited, which is never its own duplicate. */
export const authoringDuplicateQuerySchema = questionDraftSchema.extend({
  exceptId: z.string().nullable().default(null),
});
export type AuthoringDuplicateQuery = z.infer<typeof authoringDuplicateQuerySchema>;

export const authoringTagsSchema = z.object({ tags: z.array(z.string()) });
export type AuthoringTags = z.infer<typeof authoringTagsSchema>;

export const ADMIN_AUTHORING_ROUTES = {
  stats: '/admin/authoring/stats',
  history: '/admin/authoring/questions',
  create: '/admin/authoring/questions',
  get: (id: string) => `/admin/authoring/questions/${id}`,
  update: (id: string) => `/admin/authoring/questions/${id}`,
  remove: (id: string) => `/admin/authoring/questions/${id}`,
  duplicate: '/admin/authoring/duplicate',
} as const;
