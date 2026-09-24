/**
 * Asking for counting, never doing it. A student's own totals commit with their marks, so nothing
 * here is on the path of a first evaluation; what this queues is the cohort's periodic recount and
 * the bounded rebuilds a re-score or a void needs.
 */
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import {
  COHORT_SWEEP_JOB_ID,
  QUEUE_NAMES,
  ROLLUP_JOBS,
  ROLLUP_SWEEP_DELAY_MS,
  ROLLUP_REBUILD_DELAY_MS,
  keyedJob,
  rollupRebuildJobId,
  rollupRebuildNowJobId,
  rollupRebuildStudentJobId,
  type RollupJobData,
} from '../queue/queues';

@Injectable()
export class RollupQueue {
  constructor(@InjectQueue(QUEUE_NAMES.ROLLUP) private readonly rollup: Queue<RollupJobData>) {}

  /** Asks for a pass. The pass finds its own tests, so a burst of evaluations is one job. */
  async sweep(): Promise<void> {
    await this.rollup.add(
      ROLLUP_JOBS.SWEEP_COHORTS,
      {},
      { ...keyedJob(COHORT_SWEEP_JOB_ID), delay: ROLLUP_SWEEP_DELAY_MS, removeOnComplete: true },
    );
  }

  /** One id per test: a retained one, done or dead, would swallow the next hour's rebuild. */
  async rebuild(testId: string): Promise<void> {
    await this.rebuildLater(ROLLUP_JOBS.REBUILD_TEST, { testId }, rollupRebuildJobId(testId));
  }

  /** Now, not after the debounce: a rebuild writes its answer outright, so running it twice is safe. */
  async rebuildNow(testId: string): Promise<void> {
    await this.enqueue(ROLLUP_JOBS.REBUILD_TEST, { testId }, rollupRebuildNowJobId(testId), 0);
  }

  /** One student's two tables, for a void that took a sitting out of their own history. */
  async rebuildStudent(studentId: string): Promise<void> {
    await this.rebuildLater(
      ROLLUP_JOBS.REBUILD_STUDENT,
      { studentId },
      rollupRebuildStudentJobId(studentId),
    );
  }

  private async rebuildLater(name: string, data: RollupJobData, jobId: string): Promise<void> {
    await this.enqueue(name, data, jobId, ROLLUP_REBUILD_DELAY_MS);
  }

  private async enqueue(
    name: string,
    data: RollupJobData,
    jobId: string,
    delay: number,
  ): Promise<void> {
    await this.rollup.add(name, data, { ...keyedJob(jobId), delay, removeOnComplete: true });
  }
}
