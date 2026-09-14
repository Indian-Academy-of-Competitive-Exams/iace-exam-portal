import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Job } from 'bullmq';
import { type RollupService } from '../src/attempts/rollup.service';
import { RollupProcessor } from '../src/attempts/rollup.processor';
import { RollupOutbox } from '../src/attempts/rollup-outbox';
import { FOLD_PENDING_JOB_ID, ROLLUP_JOBS, type RollupJobData } from '../src/queue/queues';
import { FakeQueue, fakeQueueFailures } from './support/fakes';

describe('RollupProcessor — dispatching a job to the service', () => {
  /** A fold-attempt job queued before the deploy still has to drain, and it drains as a pass. */
  it('asks for a pass on a legacy FOLD job too, never a fold of the one attempt it names', async () => {
    const calls: string[] = [];
    const rollup = {
      foldPending: async () => {
        calls.push('foldPending');
        return 0;
      },
    } as unknown as RollupService;
    const processor = new RollupProcessor(rollup, fakeQueueFailures());

    await processor.process({
      name: ROLLUP_JOBS.FOLD,
      data: { attemptId: 'att_1' },
    } as Job<RollupJobData>);
    await processor.process({ name: ROLLUP_JOBS.FOLD_PENDING, data: {} } as Job<RollupJobData>);

    assert.deepEqual(calls, ['foldPending', 'foldPending']);
  });
});

describe('RollupOutbox — getting the fold asked for', () => {
  /** A job kept under a fixed id is a wedge: BullMQ drops every later add for that id in silence. */
  it('keeps no job under a fixed id, whether it completed or failed', async () => {
    const queue = new FakeQueue();
    const outbox = new RollupOutbox(queue.asQueue());

    await outbox.relay();
    await outbox.rebuild('tst_1');
    await outbox.rebuildStudent('stu_1');

    assert.deepEqual(
      queue.jobs.map((job) => [job.jobId, job.removeOnComplete, job.removeOnFail]),
      [
        [FOLD_PENDING_JOB_ID, true, true],
        ['rollup-rebuild-tst_1', true, true],
        ['rollup-rebuild-student-stu_1', true, true],
      ],
    );
  });
});
