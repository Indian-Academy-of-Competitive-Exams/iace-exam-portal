/** Queue names live here so producers and processors can never disagree. */
export const QUEUE_NAMES = {
  SCORING: 'scoring',
  AUDIT_ARCHIVE: 'audit-archive',
  ATTEMPT_FLUSH: 'attempt-flush',
  ATTEMPT_SWEEP: 'attempt-sweep',
  OUTBOX_PRUNE: 'outbox-prune',
  ROLLUP: 'rollup',
  NOTIFICATIONS: 'notifications',
  NOTIFICATION_DELIVERY: 'notification-delivery',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const DAY_SEC = 24 * 60 * 60;

/** How hard each queue is worked and how long a failure is kept. 6B retunes this table under load. */
export const QUEUE_POLICY = {
  // The submit spike. One at a time would drain a hall of five thousand one sitting at a time.
  [QUEUE_NAMES.SCORING]: { concurrency: 8, attempts: 5, backoffMs: 5000 },
  // Folds land on the same test's aggregate rows, so a wide fan-out only buys lock contention.
  [QUEUE_NAMES.ROLLUP]: { concurrency: 2, attempts: 5, backoffMs: 5000 },
  // Scheduled sweeps over one shared set. Two at once would fight over the same keys.
  [QUEUE_NAMES.ATTEMPT_FLUSH]: { concurrency: 1, attempts: 3, backoffMs: 2000 },
  [QUEUE_NAMES.ATTEMPT_SWEEP]: { concurrency: 1, attempts: 3, backoffMs: 2000 },
  [QUEUE_NAMES.AUDIT_ARCHIVE]: { concurrency: 1, attempts: 3, backoffMs: 2000 },
  [QUEUE_NAMES.OUTBOX_PRUNE]: { concurrency: 1, attempts: 3, backoffMs: 2000 },
  // Writing rows and booking deliveries. A broadcast arrives in chunks, so width beats depth here.
  [QUEUE_NAMES.NOTIFICATIONS]: { concurrency: 4, attempts: 5, backoffMs: 5000 },
  // Held narrow on purpose: this is what a rate-limited aggregator sees, and it is billable.
  [QUEUE_NAMES.NOTIFICATION_DELIVERY]: { concurrency: 2, attempts: 4, backoffMs: 15000 },
} as const satisfies Record<
  QueueName,
  { concurrency: number; attempts: number; backoffMs: number }
>;

/** A job that ran out of attempts is the dead letter: kept a week, because nobody watches on the day. */
export const FAILED_JOB_RETENTION = { age: 7 * DAY_SEC, count: 5000 } as const;

/** A success is evidence for an hour, and then it is only taking up memory Redis may not evict. */
export const COMPLETED_JOB_RETENTION = { age: 3600, count: 1000 } as const;

/** Everything one queue needs registering: retention, retries and the backoff between them. */
export function jobOptionsFor(queue: QueueName) {
  const { attempts, backoffMs } = QUEUE_POLICY[queue];
  return {
    attempts,
    backoff: { type: 'exponential', delay: backoffMs },
    removeOnComplete: { ...COMPLETED_JOB_RETENTION },
    removeOnFail: { ...FAILED_JOB_RETENTION },
  };
}

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

/** What a rollup job is: one sitting to fold in, one test or student to rebuild, or every table. */
export const ROLLUP_JOBS = {
  FOLD: 'fold-attempt',
  REBUILD_TEST: 'rebuild-test',
  REBUILD_STUDENT: 'rebuild-student',
  REBUILD_ALL: 'rebuild-all',
} as const;

export type RollupJob = (typeof ROLLUP_JOBS)[keyof typeof ROLLUP_JOBS];

/** Ids only, like every other job: the worker re-reads whatever it is about to fold. */
export interface RollupJobData {
  attemptId?: string;
  testId?: string;
  studentId?: string;
}

/** The EVENT's own: a redelivered relay is the same job, so one evaluation folds once. */
export function rollupJobId(eventId: string): string {
  return `${QUEUE_NAMES.ROLLUP}-${eventId}`;
}

/** The TEST's own: every re-score of one paper collapses into the single rebuild they all want. */
export function rollupRebuildJobId(testId: string): string {
  return `${QUEUE_NAMES.ROLLUP}-rebuild-${testId}`;
}

/** The STUDENT's own: voiding several of their sittings collapses into the one recount they need. */
export function rollupRebuildStudentJobId(studentId: string): string {
  return `${QUEUE_NAMES.ROLLUP}-rebuild-student-${studentId}`;
}

/** Long enough for a drop's re-scores to land before the rebuild reads them back. */
export const ROLLUP_REBUILD_DELAY_MS = 60 * 1000;

/** Writing one request, or sweeping up whatever a crash left unrelayed. */
export const NOTIFICATION_JOBS = {
  WRITE: 'write-notification',
  SWEEP: 'relay-sweep',
  /** Finds tests that have opened since anybody was last told, and tells whoever reaches them. */
  TESTS_OPENED: 'tests-opened-sweep',
} as const;

/** Sweep only, unlike scoring: nothing here is latency-sensitive beside a ten-minute window. */
export const NOTIFICATION_SWEEP_EVERY_MS = 60 * 1000;

/** A test opening is not to the minute; five is soon enough and a fifth of the wake-ups. */
export const TESTS_OPENED_SWEEP_EVERY_MS = 5 * 60 * 1000;

/** Ids only, like every other job: the worker re-reads the outbox row it is about to act on. */
export interface NotificationJobData {
  eventId?: string;
}

/** One delivery row to attempt. The worker re-reads it, so a stale retry cannot send a stale message. */
export interface NotificationDeliveryJobData {
  deliveryId: string;
}

/** The EVENT's own: a redelivered relay is the same job, so one fact notifies once. */
export function notificationJobId(eventId: string): string {
  return `${QUEUE_NAMES.NOTIFICATIONS}-${eventId}`;
}

/** The DELIVERY ROW's own, so a re-queued escalation cannot buy the same message twice. */
export function notificationDeliveryJobId(deliveryId: string): string {
  return `${QUEUE_NAMES.NOTIFICATION_DELIVERY}-${deliveryId}`;
}

/** How often the live sittings are drained to Postgres. A crash costs at most this much. */
export const ATTEMPT_FLUSH_EVERY_MS = 60 * 1000;

/** How often sittings past their deadline are ended. Slower: nothing is lost by ending one late. */
export const ATTEMPT_SWEEP_EVERY_MS = 2 * 60 * 1000;

/** Nightly, at an hour no Indian coaching branch is running a test. */
export const OUTBOX_PRUNE_CRON = '45 20 * * *';
