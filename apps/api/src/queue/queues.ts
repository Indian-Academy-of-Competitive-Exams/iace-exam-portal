/** Queue names live here so producers and processors can never disagree. */
export const QUEUE_NAMES = {
  SCORING: 'scoring',
  AUDIT_ARCHIVE: 'audit-archive',
  ATTEMPT_FLUSH: 'attempt-flush',
  ATTEMPT_SWEEP: 'attempt-sweep',
  OUTBOX_PRUNE: 'outbox-prune',
} as const;

/** Payload for a scoring job. Kept to ids — workers re-read from Postgres. */
export interface ScoringJobData {
  attemptId: string;
  testId: string;
}

/** The attempt's own, so a redelivered request is the same job rather than a second scoring. */
export function scoringJobId(attemptId: string): string {
  return `${QUEUE_NAMES.SCORING}-${attemptId}`;
}

/** How often the live sittings are drained to Postgres. A crash costs at most this much. */
export const ATTEMPT_FLUSH_EVERY_MS = 60 * 1000;

/** How often sittings past their deadline are ended. Slower: nothing is lost by ending one late. */
export const ATTEMPT_SWEEP_EVERY_MS = 2 * 60 * 1000;

/** Nightly, at an hour no Indian coaching branch is running a test. */
export const OUTBOX_PRUNE_CRON = '45 20 * * *';
