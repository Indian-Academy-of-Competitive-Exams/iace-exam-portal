import { z } from 'zod';
import { paginationQuerySchema } from './envelope';

// ============================================================================
// Two lists in one table, both the signed-in student's own: BOOKMARK is theirs
// to add and drop, MISTAKE is written by the fold of an evaluated sitting. No
// id names a student here — the token is the subject, as everywhere under /me.
// ============================================================================

/** Which list a row belongs to. A question can sit on both, as two rows. */
export const SAVED_QUESTION_KIND = {
  BOOKMARK: 'BOOKMARK',
  MISTAKE: 'MISTAKE',
} as const;
export const savedQuestionKindSchema = z.enum(SAVED_QUESTION_KIND);
export type SavedQuestionKind = z.infer<typeof savedQuestionKindSchema>;
export const SAVED_QUESTION_KINDS = savedQuestionKindSchema.options;

/** What the exam world calls each list. */
export const SAVED_QUESTION_KIND_LABELS: Readonly<Record<SavedQuestionKind, string>> = {
  [SAVED_QUESTION_KIND.BOOKMARK]: 'Bookmarks',
  [SAVED_QUESTION_KIND.MISTAKE]: 'Mistakes',
};

/** Stem preview and taxonomy only: this list is read while a paper holding the question is live. */
export const savedQuestionSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  kind: savedQuestionKindSchema,
  stemPreview: z.string(),
  subject: z.string(),
  topic: z.string().nullable(),
  /** The sitting it came from, so the row can open the solution it belongs to. Null once erased. */
  attemptId: z.string().nullable(),
  createdAt: z.string(),
});
export type SavedQuestion = z.infer<typeof savedQuestionSchema>;

export const savedListQuerySchema = paginationQuerySchema.extend({
  kind: savedQuestionKindSchema,
});
export type SavedListQuery = z.infer<typeof savedListQuerySchema>;
export type SavedListQueryInput = z.input<typeof savedListQuerySchema>;

/** Which sitting the star was pressed in — it is both the provenance and the right to save. */
export const bookmarkQuestionSchema = z.object({
  attemptId: z.string().min(1),
  questionId: z.string().min(1),
});
export type BookmarkQuestionBody = z.infer<typeof bookmarkQuestionSchema>;
export type BookmarkQuestionInput = z.input<typeof bookmarkQuestionSchema>;

/** Each starred question with its row id, matched on the QUESTION so another paper's copy counts. */
export const bookmarkedInAttemptSchema = z.object({
  attemptId: z.string(),
  bookmarks: z.array(z.object({ questionId: z.string(), savedId: z.string() })),
});
export type BookmarkedInAttempt = z.infer<typeof bookmarkedInAttemptSchema>;

export const SAVED_ROUTES = {
  list: '/me/saved',
  bookmark: '/me/saved/bookmarks',
  /** Drops one row, whichever list it is on — a dismissed mistake returns if they miss it again. */
  remove: (id: string) => `/me/saved/${id}`,
  inAttempt: (attemptId: string) => `/me/saved/bookmarks/attempts/${attemptId}`,
} as const;
