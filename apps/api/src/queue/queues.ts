/** Queue names live here so producers and processors can never disagree. */
export const QUEUE_NAMES = {
  SCORING: 'scoring',
  AUDIT_ARCHIVE: 'audit-archive',
  ATTEMPT_FLUSH: 'attempt-flush',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Payload for a scoring job. Kept to ids — workers re-read from Postgres. */
export interface ScoringJobData {
  attemptId: string;
  testId: string;
}

/** How often the live sittings are drained to Postgres. A crash costs at most this much. */
export const ATTEMPT_FLUSH_EVERY_MS = 60 * 1000;
