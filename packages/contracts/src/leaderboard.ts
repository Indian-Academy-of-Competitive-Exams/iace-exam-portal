import { z } from 'zod';

// ============================================================================
// The board a signed-in student reads: a podium, their own neighbourhood, and
// nothing else about anybody. There is no public route to this payload and
// there must never be one — a shared link carries one student's OWN report.
//
// A row is a name, a branch, a standing and a number. No mobile, no email, no
// attempt id, no per-question data, no answer key.
// ============================================================================

/** ONE paper. Marks compare only within a single paper, and no other measure earns a board. */
export const leaderboardQuerySchema = z.object({ testId: z.string().min(1) });
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

/** How many seats the podium holds. */
export const LEADERBOARD_PODIUM = 3;

/** Seats either side of the reader — the neighbourhood is this wide both ways. */
export const LEADERBOARD_NEIGHBOURS = 3;

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
  /** The seats around the reader, podium seats excluded so no row is drawn twice. */
  neighbourhood: z.array(leaderboardRowSchema),
  /** The reader's own standing, wherever they sit. Null until they are on the board. */
  you: leaderboardRowSchema.nullable(),
  generatedAt: z.string(),
});
export type Leaderboard = z.infer<typeof leaderboardSchema>;

/** Signed in, always. There is no public leaderboard route and must never be one. */
export const LEADERBOARD_ROUTES = {
  me: '/me/leaderboard',
} as const;
