/** Queue names live here so producers and processors can never disagree. */
export const QUEUE_NAMES = {
  SCORING: 'scoring',
  LEADERBOARD_REBUILD: 'leaderboard-rebuild',
  AUDIT_ARCHIVE: 'audit-archive',
  ATTEMPT_FLUSH: 'attempt-flush',
  ATTEMPT_SWEEP: 'attempt-sweep',
  OUTBOX_PRUNE: 'outbox-prune',
  ROLLUP: 'rollup',
} as const;

/** Payload for a scoring job. Kept to ids — workers re-read from Postgres. */
export interface ScoringJobData {
  attemptId: string;
  testId: string;
}

/** The REQUEST's own: a redelivery is the same job, while a re-score is a new one that runs. */
export function scoringJobId(requestId: string): string {
  return `${QUEUE_NAMES.SCORING}-${requestId}`;
}

/** How long an ended sitting may sit unscored before the sweeper asks for a score again. */
export const SCORING_RETRY_AFTER_MS = 5 * 60 * 1000;

/** How many stranded events one relay pass hands on. */
export const RELAY_BATCH = 200;

/** How long an event must sit before a SWEEP takes it: its writer may still be finishing. */
export const RELAY_GRACE_SEC = 30;

/** What a rollup job is: one sitting to fold in, one test to rebuild, or every table at once. */
export const ROLLUP_JOBS = {
  FOLD: 'fold-attempt',
  REBUILD_TEST: 'rebuild-test',
  REBUILD_ALL: 'rebuild-all',
} as const;

export type RollupJob = (typeof ROLLUP_JOBS)[keyof typeof ROLLUP_JOBS];

/** Ids only, like every other job: the worker re-reads whatever it is about to fold. */
export interface RollupJobData {
  attemptId?: string;
  testId?: string;
}

/** The EVENT's own: a redelivered relay is the same job, so one evaluation folds once. */
export function rollupJobId(eventId: string): string {
  return `${QUEUE_NAMES.ROLLUP}-${eventId}`;
}

/** The TEST's own: every re-score of one paper collapses into the single rebuild they all want. */
export function rollupRebuildJobId(testId: string): string {
  return `${QUEUE_NAMES.ROLLUP}-rebuild-${testId}`;
}

/** Long enough for a drop's re-scores to land before the rebuild reads them back. */
export const ROLLUP_REBUILD_DELAY_MS = 60 * 1000;

/** Payload for a leaderboard rebuild. One test's board, put back from the durable marks. */
export interface LeaderboardRebuildJobData {
  testId: string;
}

/** How often the live sittings are drained to Postgres. A crash costs at most this much. */
export const ATTEMPT_FLUSH_EVERY_MS = 60 * 1000;

/** How often sittings past their deadline are ended. Slower: nothing is lost by ending one late. */
export const ATTEMPT_SWEEP_EVERY_MS = 2 * 60 * 1000;

/** Nightly, at an hour no Indian coaching branch is running a test. */
export const OUTBOX_PRUNE_CRON = '45 20 * * *';
