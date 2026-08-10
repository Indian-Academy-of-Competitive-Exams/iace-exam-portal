/**
 * Queue names live here so producers and processors can never disagree.
 *
 * SCORING is the one that matters for scale: on submit the API enqueues a job
 * and returns immediately, so a spike of thousands of simultaneous submissions
 * becomes a draining queue instead of thousands of synchronous DB writes.
 * It is a placeholder in Phase 0 — the evaluator arrives with the test engine.
 */
export const QUEUE_NAMES = {
  SCORING: 'scoring',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Payload for a scoring job. Kept to ids — workers re-read from Postgres. */
export interface ScoringJobData {
  attemptId: string;
  testId: string;
}
