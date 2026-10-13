import { z } from 'zod';
import { PAGE_SIZE_MAX } from './envelope';

// ============================================================================
// The board a signed-in student reads: a podium, the ranking under it a page at
// a time, and their own seat wherever it is. There is no public route to this
// payload and there must never be one — a shared link carries one student's OWN report.
//
// A row is a name, a branch, a standing and a number. No mobile, no email, no
// attempt id, no per-question data, no answer key.
// ============================================================================

/** ONE paper. Marks compare only within a single paper, and no other measure earns a board. */
/** How many seats the podium holds. */
export const LEADERBOARD_PODIUM = 3;

/** Seats on one page of the ranking under the podium. */
export const LEADERBOARD_PAGE_SIZE = 20;

export const leaderboardQuerySchema = z.object({
  testId: z.string().min(1),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(LEADERBOARD_PAGE_SIZE),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
export type LeaderboardQueryInput = z.input<typeof leaderboardQuerySchema>;

/** The page of the ranking a rank sits on, or null on the podium, which is on no page. */
export function leaderboardPageOf(rank: number, pageSize: number): number | null {
  return rank <= LEADERBOARD_PODIUM ? null : Math.ceil((rank - LEADERBOARD_PODIUM) / pageSize);
}

const leaderboardRowSchema = z.object({
  rank: z.number().int(),
  name: z.string(),
  branch: z.string().nullable(),
  /** Marks on this paper, which is the only thing a cohort is ever ranked on. */
  score: z.number(),
  /** The reader's own only. Nobody else's percentile is on the board. */
  percentile: z.number().nullable(),
  isYou: z.boolean(),
});
export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;

export const leaderboardSchema = z.object({
  testId: z.string(),
  label: z.string().nullable(),
  cohortSize: z.number().int(),
  podium: z.array(leaderboardRowSchema),
  /** One page of the ranking under the podium, so no seat is drawn twice. */
  rows: z.array(leaderboardRowSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** Every seat under the podium, across all pages. */
  total: z.number().int(),
  /** The reader's own standing, wherever they sit. Null until they are on the board. */
  you: leaderboardRowSchema.nullable(),
  /** The page that holds the reader. Null on the podium, and until they are on the board. */
  yourPage: z.number().int().nullable(),
  generatedAt: z.string(),
});
export type Leaderboard = z.infer<typeof leaderboardSchema>;

/** Signed in, always. There is no public leaderboard route and must never be one. */
export const LEADERBOARD_ROUTES = {
  me: '/me/leaderboard',
} as const;
