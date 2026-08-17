/** Queue names live here so producers and processors can never disagree. */
export const QUEUE_NAMES = {
  SCORING: 'scoring',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Payload for a scoring job. Kept to ids — workers re-read from Postgres. */
export interface ScoringJobData {
  attemptId: string;
  testId: string;
}
