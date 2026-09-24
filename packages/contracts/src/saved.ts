import { z } from 'zod';
import { paginationQuerySchema } from './envelope';
import { csvIdQuery } from './common';

// ============================================================================
// The questions a student starred in a solution review, theirs to add and to
// drop. No id names a student here — the token is the subject, as everywhere
// under /me. What they got WRONG is not here: the answer sheet already records
// every verdict, and the question report filters on it.
// ============================================================================

/** Stem preview and taxonomy only: this list is read while a paper holding the question is live. */
export const savedQuestionSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  stemPreview: z.string(),
  subject: z.string(),
  topic: z.string().nullable(),
  /** The sitting it came from, so the row can open the solution it belongs to. Null once erased. */
  attemptId: z.string().nullable(),
  /** Which paper they met it on — the thing a revision list is actually sorted through. */
  testId: z.string().nullable(),
  testTitle: z.string().nullable(),
  /** What that sitting cost them on this question. Null where the sitting is gone. */
  timeSpentSec: z.number().int().nullable(),
  createdAt: z.string(),
});
export type SavedQuestion = z.infer<typeof savedQuestionSchema>;

export const savedListQuerySchema = paginationQuerySchema.extend({
  /** Narrows to what they are revising. An empty choice is every subject, never none. */
  subjectId: csvIdQuery(),
  /** The same, by the paper it came from. */
  testId: csvIdQuery(),
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

/** One filterable value. Read off the student's OWN set, so no choice can find nothing. */
const savedFacetSchema = z.object({ id: z.string(), name: z.string() });

/** Every choice both filters can offer, in one read — two pickers are not two round trips. */
export const savedFacetsSchema = z.object({
  subjects: z.array(savedFacetSchema),
  tests: z.array(savedFacetSchema),
});
export type SavedFacets = z.infer<typeof savedFacetsSchema>;

export const SAVED_ROUTES = {
  list: '/me/saved',
  facets: '/me/saved/facets',
  bookmark: '/me/saved/bookmarks',
  remove: (id: string) => `/me/saved/${id}`,
  inAttempt: (attemptId: string) => `/me/saved/bookmarks/attempts/${attemptId}`,
} as const;
