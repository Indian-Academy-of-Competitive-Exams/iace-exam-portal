import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COMPLETED_JOB_RETENTION,
  FAILED_JOB_RETENTION,
  QUEUE_NAMES,
  QUEUE_POLICY,
  jobOptionsFor,
} from '../src/queue/queues';

describe('queue policy', () => {
  it('gives every queue a policy, so a new one cannot default to nothing', () => {
    for (const name of Object.values(QUEUE_NAMES)) {
      assert.ok(QUEUE_POLICY[name], name);
    }
  });

  /** The submit spike is the whole reason scoring is a queue: one worker would drain it serially. */
  it('works scoring hardest, and the shared-state sweeps one at a time', () => {
    assert.ok(QUEUE_POLICY[QUEUE_NAMES.SCORING].concurrency > 1);
    assert.equal(QUEUE_POLICY[QUEUE_NAMES.ATTEMPT_FLUSH].concurrency, 1);
    assert.equal(QUEUE_POLICY[QUEUE_NAMES.ATTEMPT_SWEEP].concurrency, 1);
  });

  it('retries a scoring job more than once, backing off between tries', () => {
    const options = jobOptionsFor(QUEUE_NAMES.SCORING);

    assert.ok(options.attempts > 1);
    assert.equal(options.backoff.type, 'exponential');
    assert.ok(options.backoff.delay > 0);
  });

  /** A job that ran out of attempts IS the dead letter, so it has to outlive the day it failed on. */
  it('keeps a failed job far longer than a finished one', () => {
    const options = jobOptionsFor(QUEUE_NAMES.ROLLUP);

    assert.equal(options.removeOnFail.age, FAILED_JOB_RETENTION.age);
    assert.equal(options.removeOnComplete.age, COMPLETED_JOB_RETENTION.age);
    assert.ok(FAILED_JOB_RETENTION.age > COMPLETED_JOB_RETENTION.age * 24);
  });
});
