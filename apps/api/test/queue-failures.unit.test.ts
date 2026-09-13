import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Job } from 'bullmq';
import { QueueFailures } from '../src/common/metrics/queue-failures';
import { QUEUE_NAMES } from '../src/queue/queues';
import { FakeMetrics } from './support/fakes';

const job = (attemptsMade: number, attempts: number): Job =>
  ({ id: 'job_1', attemptsMade, opts: { attempts } }) as unknown as Job;

function build() {
  const metrics = new FakeMetrics();
  return { metrics, failures: new QueueFailures(metrics.asService()) };
}

describe('QueueFailures', () => {
  /** The signal 6B alerts on: a try that will come round again is not an outage. */
  it('separates a try that will happen again from the one that will not', () => {
    const { metrics, failures } = build();

    failures.record(QUEUE_NAMES.SCORING, job(2, 5), new Error('postgres is down'));
    failures.record(QUEUE_NAMES.SCORING, job(5, 5), new Error('postgres is down'));

    assert.deepEqual(metrics.queueFailures, [
      { queue: QUEUE_NAMES.SCORING, spent: false },
      { queue: QUEUE_NAMES.SCORING, spent: true },
    ]);
  });

  /** The failure this prevents: nothing retains a spent job now, so silence is the only record. */
  it('reads a job it was handed nothing about as spent', () => {
    const { metrics, failures } = build();

    failures.record(QUEUE_NAMES.ROLLUP, undefined, new Error('lost before it loaded'));

    assert.deepEqual(metrics.queueFailures, [{ queue: QUEUE_NAMES.ROLLUP, spent: true }]);
  });

  /** A job with no attempts of its own gets one, so its first failure is already its last. */
  it('counts a single-attempt job spent the first time it throws', () => {
    const { metrics, failures } = build();

    failures.record(
      QUEUE_NAMES.OUTBOX_PRUNE,
      { id: 'j', attemptsMade: 1, opts: {} } as Job,
      new Error('x'),
    );

    assert.equal(metrics.queueFailures[0]?.spent, true);
  });
});
