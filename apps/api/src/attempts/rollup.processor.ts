/** Counting, off every request path: the cohort sweep, one bounded rebuild, or every table. */
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job } from 'bullmq';
import {
  DRAINED_ROLLUP_JOBS,
  QUEUE_NAMES,
  QUEUE_POLICY,
  ROLLUP_JOBS,
  type RollupJobData,
} from '../queue/queues';
import { RollupService } from './rollup.service';
import { QueueFailures } from '../common/metrics/queue-failures';

@Processor(QUEUE_NAMES.ROLLUP, { concurrency: QUEUE_POLICY[QUEUE_NAMES.ROLLUP].concurrency })
export class RollupProcessor extends WorkerHost {
  private readonly logger = new Logger(RollupProcessor.name);

  constructor(
    private readonly rollup: RollupService,
    private readonly failures: QueueFailures,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.failures.record(QUEUE_NAMES.ROLLUP, job, error);
  }

  async process(job: Job<RollupJobData>): Promise<void> {
    // A fold queued before this deploy asks for the same thing the sweep does: count what changed.
    if (isDrained(job.name)) {
      await this.rollup.sweepCohorts();
      return;
    }
    switch (job.name) {
      case ROLLUP_JOBS.SWEEP_COHORTS:
        await this.rollup.sweepCohorts();
        return;
      case ROLLUP_JOBS.REBUILD_TEST:
        return this.rebuildOne(job.data.testId);
      case ROLLUP_JOBS.REBUILD_STUDENT:
        return this.rebuildStudent(job.data.studentId);
      case ROLLUP_JOBS.REBUILD_ALL:
        return this.rollup.rebuildAll();
      default:
        this.logger.error(`Rollup job ${job.id ?? ''} is a "${job.name}", which nothing folds`);
    }
  }

  private async rebuildOne(testId: string | undefined): Promise<void> {
    if (testId === undefined) {
      this.logger.error('A rebuild job names no test, so there is nothing to recount');
      return;
    }
    await this.rollup.rebuildTest(testId);
  }

  private async rebuildStudent(studentId: string | undefined): Promise<void> {
    if (studentId === undefined) {
      this.logger.error('A rebuild job names no student, so there is nothing to recount');
      return;
    }
    await this.rollup.rebuildStudent(studentId);
  }
}

const isDrained = (name: string): boolean =>
  (DRAINED_ROLLUP_JOBS as readonly string[]).includes(name);
