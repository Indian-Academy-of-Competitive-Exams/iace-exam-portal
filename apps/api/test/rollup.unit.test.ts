import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Job } from 'bullmq';
import { type RollupService } from '../src/attempts/rollup.service';
import { RollupProcessor } from '../src/attempts/rollup.processor';
import { RollupQueue } from '../src/attempts/rollup-queue';
import {
  COHORT_SWEEP_JOB_ID,
  DRAINED_ROLLUP_JOBS,
  ROLLUP_JOBS,
  ROLLUP_REBUILD_DELAY_MS,
  type RollupJobData,
} from '../src/queue/queues';
import { FakeQueue, fakeQueueFailures } from './support/fakes';

describe('RollupProcessor — dispatching a job to the service', () => {
  /** A fold job queued before the deploy still has to drain, and it drains as a cohort sweep. */
  it('sweeps on a drained fold job too, never a fold of the one attempt it names', async () => {
    const calls: string[] = [];
    const rollup = {
      sweepCohorts: async () => {
        calls.push('sweepCohorts');
        return 0;
      },
    } as unknown as RollupService;
    const processor = new RollupProcessor(rollup, fakeQueueFailures());

    for (const name of [...DRAINED_ROLLUP_JOBS, ROLLUP_JOBS.SWEEP_COHORTS]) {
      await processor.process({ name, data: { attemptId: 'att_1' } } as Job<RollupJobData>);
    }

    assert.deepEqual(calls, DRAINED_ROLLUP_JOBS.map(() => 'sweepCohorts').concat('sweepCohorts'));
  });
});

describe('RollupQueue — getting the counting asked for', () => {
  /** A job kept under a fixed id is a wedge: BullMQ drops every later add for that id in silence. */
  it('keeps no job under a fixed id, whether it completed or failed', async () => {
    const queue = new FakeQueue();
    const outbox = new RollupQueue(queue.asQueue());

    await outbox.sweep();
    await outbox.rebuild('tst_1');
    await outbox.rebuildStudent('stu_1');

    assert.deepEqual(
      queue.jobs.map((job) => [job.jobId, job.removeOnComplete, job.removeOnFail]),
      [
        [COHORT_SWEEP_JOB_ID, true, true],
        ['rollup-rebuild-tst_1', true, true],
        ['rollup-rebuild-student-stu_1', true, true],
      ],
    );
  });

  /** A debounced rebuild already waiting would swallow a re-sync filed under its id. */
  it('queues a re-sync now, under its own id, beside a rebuild still waiting out its delay', async () => {
    const queue = new FakeQueue();
    const outbox = new RollupQueue(queue.asQueue());

    await outbox.rebuild('tst_1');
    await outbox.rebuildNow('tst_1');
    await outbox.rebuildNow('tst_1');

    assert.deepEqual(
      queue.jobs.map((job) => [job.name, job.data, job.jobId, job.delay, job.removeOnComplete]),
      [
        [
          ROLLUP_JOBS.REBUILD_TEST,
          { testId: 'tst_1' },
          'rollup-rebuild-tst_1',
          ROLLUP_REBUILD_DELAY_MS,
          true,
        ],
        [ROLLUP_JOBS.REBUILD_TEST, { testId: 'tst_1' }, 'rollup-rebuild-tst_1-now', 0, true],
      ],
    );
  });
});
