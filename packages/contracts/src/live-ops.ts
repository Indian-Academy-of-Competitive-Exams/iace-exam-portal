import { z } from 'zod';
import { searchQuery } from './common';
import { paginationQuerySchema } from './envelope';
import { attemptStatusSchema } from './attempts';

// ============================================================================
// Live operations: watching the sittings of ONE test, and resolving the ones
// that broke. Everything here is scoped to a chosen test — there is no read
// that scans every attempt, and no panel that carries answer content, because
// this is a liveness view rather than a proctoring one.
// ============================================================================

/** How many sittings one panel names. The counts beside it are the whole cohort. */
export const LIVE_OPS_ROW_CAP = 100;

/** What "landing now" means for the submissions panel. */
export const LIVE_OPS_RECENT_MINUTES = 30;

/** The board is ambient, not tick-accurate: a poll this often is enough to watch a hall by. */
export const LIVE_OPS_POLL_MS = 15_000;

/** The longest one extension may add. Anything beyond it is a schedule change, not support. */
export const EXTEND_MINUTES_MAX = 180;

/** A test worth watching, as the picker names it. */
export const liveOpsTestSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  seriesName: z.string(),
  stageName: z.string(),
  /** When it opens, which is the whole of a test's timing — nothing shuts one. */
  opensAt: z.string().nullable(),
});
export type LiveOpsTest = z.infer<typeof liveOpsTestSchema>;

export const liveOpsTestQuerySchema = paginationQuerySchema.extend({ q: searchQuery() });
export type LiveOpsTestQuery = z.infer<typeof liveOpsTestQuerySchema>;
export type LiveOpsTestQueryInput = z.input<typeof liveOpsTestQuerySchema>;

/** One sitting in flight. `answeredCount` is null when Redis holds no live state for it. */
export const liveSittingSchema = z.object({
  attemptId: z.string(),
  studentId: z.string(),
  studentName: z.string().nullable(),
  mobile: z.string(),
  branchName: z.string().nullable(),
  attemptNo: z.number().int(),
  isGraded: z.boolean(),
  startedAt: z.string(),
  endsAt: z.string(),
  questionCount: z.number().int(),
  answeredCount: z.number().int().nullable(),
  /** False when the live key has gone — the sitting the reset action exists for. */
  hasLiveState: z.boolean(),
});
export type LiveSitting = z.infer<typeof liveSittingSchema>;

/** One sitting that has landed. No marks until it is scored, which is what `status` says. */
export const recentSubmissionSchema = z.object({
  attemptId: z.string(),
  studentId: z.string(),
  studentName: z.string().nullable(),
  mobile: z.string(),
  attemptNo: z.number().int(),
  isGraded: z.boolean(),
  status: attemptStatusSchema,
  submittedAt: z.string().nullable(),
  score: z.number().nullable(),
});
export type RecentSubmission = z.infer<typeof recentSubmissionSchema>;

export const liveOpsCountsSchema = z.object({
  active: z.number().int(),
  /** Past their own deadline and still open: the sweeper's backlog, not a shut window. */
  stuck: z.number().int(),
  submittedRecently: z.number().int(),
  /** Ended and unscored. The sweeper heals these; a number that keeps climbing does not. */
  awaitingScoring: z.number().int(),
});
export type LiveOpsCounts = z.infer<typeof liveOpsCountsSchema>;

export const liveOpsBoardSchema = z.object({
  testId: z.string(),
  testTitle: z.string().nullable(),
  /** The server's clock, so a screen never measures a deadline against the device's. */
  serverNow: z.string(),
  counts: liveOpsCountsSchema,
  active: z.array(liveSittingSchema),
  stuck: z.array(liveSittingSchema),
  recent: z.array(recentSubmissionSchema),
});
export type LiveOpsBoard = z.infer<typeof liveOpsBoardSchema>;

// ============================================================================
// The support console. Four actions, each on one sitting, each carrying the
// reason it was taken — which is what the audit row is written from.
// ============================================================================

/** Why an admin reached into a student's sitting. Required, and kept in the audit row. */
export const supportReasonSchema = z
  .string()
  .trim()
  .min(1, 'Say why this sitting is being changed')
  .max(280);

export const forceSubmitAttemptSchema = z.object({ reason: supportReasonSchema });
export type ForceSubmitAttemptInput = z.input<typeof forceSubmitAttemptSchema>;
export type ForceSubmitAttemptBody = z.infer<typeof forceSubmitAttemptSchema>;

export const extendAttemptSchema = z.object({
  minutes: z.coerce
    .number()
    .int()
    .min(1, 'Add at least a minute')
    .max(EXTEND_MINUTES_MAX, `The most one extension adds is ${EXTEND_MINUTES_MAX} minutes`),
  reason: supportReasonSchema,
});
export type ExtendAttemptInput = z.input<typeof extendAttemptSchema>;
export type ExtendAttemptBody = z.infer<typeof extendAttemptSchema>;

export const resetAttemptSchema = z.object({ reason: supportReasonSchema });
export type ResetAttemptInput = z.input<typeof resetAttemptSchema>;
export type ResetAttemptBody = z.infer<typeof resetAttemptSchema>;

export const voidAttemptSchema = z.object({
  reason: supportReasonSchema,
  /** Ticked, the student's next sitting ranks again; left alone, the ranked slot stays spent. */
  regrantRanked: z.boolean().default(false),
});
export type VoidAttemptInput = z.input<typeof voidAttemptSchema>;
export type VoidAttemptBody = z.infer<typeof voidAttemptSchema>;

/** What a sitting looks like after an action — enough for the board to redraw the row. */
export const resolvedAttemptSchema = z.object({
  attemptId: z.string(),
  studentId: z.string(),
  testId: z.string(),
  status: attemptStatusSchema,
  endsAt: z.string(),
  isGraded: z.boolean(),
  voidedAt: z.string().nullable(),
  voidReason: z.string().nullable(),
  /** True when a fresh ranked sitting was granted with the void. */
  rankedRegranted: z.boolean(),
});
export type ResolvedAttempt = z.infer<typeof resolvedAttemptSchema>;

export const ADMIN_LIVE_OPS_ROUTES = {
  /** The picker's own list, on this key rather than TEST_MANAGEMENT: an ops admin holds neither. */
  tests: '/admin/live-ops/tests',
  board: (testId: string) => `/admin/live-ops/tests/${testId}`,
  forceSubmit: (attemptId: string) => `/admin/live-ops/attempts/${attemptId}/force-submit`,
  extend: (attemptId: string) => `/admin/live-ops/attempts/${attemptId}/extend`,
  reset: (attemptId: string) => `/admin/live-ops/attempts/${attemptId}/reset`,
  void: (attemptId: string) => `/admin/live-ops/attempts/${attemptId}/void`,
} as const;
