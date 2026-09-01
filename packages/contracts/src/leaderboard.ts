import { z } from 'zod';
import { evaluationModeSchema } from './tests';

// ============================================================================
// The board a signed-in student reads: a podium, their own neighbourhood, and
// nothing else about anybody. There is no public route to this payload and
// there must never be one — a shared link carries one student's OWN report.
//
// A row is a name, a branch, a standing and a number. No mobile, no email, no
// attempt id, no per-question data, no answer key.
// ============================================================================

/** One paper, the papers of one series, or every paper they have sat. */
export const LEADERBOARD_SCOPES = {
  TEST: 'TEST',
  SERIES: 'SERIES',
  ALL_TIME: 'ALL_TIME',
} as const;
export const leaderboardScopeSchema = z.enum(LEADERBOARD_SCOPES);
export type LeaderboardScope = z.infer<typeof leaderboardScopeSchema>;

/** Which id each scope is answered by. ALL_TIME needs none — the reader IS the scope. */
export const LEADERBOARD_SCOPE_FIELD = {
  [LEADERBOARD_SCOPES.TEST]: 'testId',
  [LEADERBOARD_SCOPES.SERIES]: 'seriesId',
  [LEADERBOARD_SCOPES.ALL_TIME]: null,
} as const satisfies Record<LeaderboardScope, string | null>;

export const leaderboardQuerySchema = z
  .object({
    scope: leaderboardScopeSchema,
    testId: z.string().min(1).optional(),
    seriesId: z.string().min(1).optional(),
  })
  .superRefine((query, ctx) => {
    const field = LEADERBOARD_SCOPE_FIELD[query.scope];
    if (field !== null && query[field] === undefined) {
      ctx.addIssue({ code: 'custom', path: [field], message: `${query.scope} needs a ${field}` });
    }
  });
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
export type LeaderboardQueryInput = z.input<typeof leaderboardQuerySchema>;

/** What a row's `value` is counted in. Marks compare only within ONE paper; percentile always. */
export const LEADERBOARD_MEASURES = {
  MARKS: 'MARKS',
  PERCENTILE_POINTS: 'PERCENTILE_POINTS',
} as const;
export const leaderboardMeasureSchema = z.enum(LEADERBOARD_MEASURES);
export type LeaderboardMeasure = z.infer<typeof leaderboardMeasureSchema>;

/** The rule the whole feature turns on: two papers are never compared on marks. */
export const LEADERBOARD_MEASURE_BY_SCOPE = {
  [LEADERBOARD_SCOPES.TEST]: LEADERBOARD_MEASURES.MARKS,
  [LEADERBOARD_SCOPES.SERIES]: LEADERBOARD_MEASURES.PERCENTILE_POINTS,
  [LEADERBOARD_SCOPES.ALL_TIME]: LEADERBOARD_MEASURES.PERCENTILE_POINTS,
} as const satisfies Record<LeaderboardScope, LeaderboardMeasure>;

/** How many seats the podium holds. */
export const LEADERBOARD_PODIUM = 3;

/** Seats either side of the reader — the neighbourhood is this wide both ways. */
export const LEADERBOARD_NEIGHBOURS = 3;

export const leaderboardRowSchema = z.object({
  rank: z.number().int(),
  name: z.string(),
  branch: z.string().nullable(),
  /** Marks on one paper, mean percentile across papers — `measure` says which. */
  value: z.number(),
  /** The reader's own only. Nobody else's percentile is on the board. */
  percentile: z.number().nullable(),
  /** Sittings behind `value`. Always one on a single paper. */
  sittings: z.number().int(),
  /** Seats gained since their previous standing; positive is up, null where there is none. */
  deltaRank: z.number().int().nullable(),
  isYou: z.boolean(),
});
export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;

export const leaderboardSchema = z.object({
  scope: leaderboardScopeSchema,
  /** The id the scope was asked about. Null for ALL_TIME. */
  scopeId: z.string().nullable(),
  label: z.string().nullable(),
  measure: leaderboardMeasureSchema,
  /** A single paper's mode; null where the board spans papers. PRACTICE is never ranked. */
  evaluationMode: evaluationModeSchema.nullable(),
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
