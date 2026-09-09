/** Counting, off every request path: one sitting folded in, one test rebuilt, or every table. */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job } from 'bullmq';
import { QUEUE_NAMES, QUEUE_POLICY, ROLLUP_JOBS, type RollupJobData } from '../queue/queues';
import { RollupService } from './rollup.service';

@Processor(QUEUE_NAMES.ROLLUP, { concurrency: QUEUE_POLICY[QUEUE_NAMES.ROLLUP].concurrency })
export class RollupProcessor extends WorkerHost {
  private readonly logger = new Logger(RollupProcessor.name);

  constructor(private readonly rollup: RollupService) {
    super();
  }

  async process(job: Job<RollupJobData>): Promise<void> {
    switch (job.name) {
      case ROLLUP_JOBS.FOLD:
        return this.foldOne(job.data.attemptId);
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

  private async foldOne(attemptId: string | undefined): Promise<void> {
    if (attemptId === undefined) {
      this.logger.error('A fold job names no sitting, so there is nothing to count');
      return;
    }
    await this.rollup.fold(attemptId);
  }

  private async rebuildOne(testId: string | undefined): Promise<void> {
    if (testId === undefined) {
      this.logger.error('A rebuild job names no test, so there is nothing to recount');
      return;
    }
    await this.rollup.rebuildForTest(testId);
  }

  private async rebuildStudent(studentId: string | undefined): Promise<void> {
    if (studentId === undefined) {
      this.logger.error('A rebuild job names no student, so there is nothing to recount');
      return;
    }
    await this.rollup.rebuildStudent(studentId);
  }
}
