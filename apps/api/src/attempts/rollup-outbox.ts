/**
 * Evaluated implies counted. The `scoring.completed` row is INSERTED in the same transaction that
 * claims the first evaluation, so the two commit together and no crash can strand a sitting the
 * aggregates never saw. Handing it to the queue is a separate, repeatable step.
 */
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import { DOMAIN_EVENTS } from '../common/events';
import {
  FOLD_PENDING_JOB_ID,
  QUEUE_NAMES,
  ROLLUP_FOLD_DELAY_MS,
  ROLLUP_JOBS,
  ROLLUP_REBUILD_DELAY_MS,
  rollupRebuildJobId,
  rollupRebuildStudentJobId,
  type RollupJobData,
} from '../queue/queues';

/** What one evaluation's fold request is called in `OutboxEvent`. */
export const ROLLUP_REQUEST = {
  AGGREGATE_TYPE: 'Attempt',
  EVENT_TYPE: DOMAIN_EVENTS.SCORING_COMPLETED,
} as const;

@Injectable()
export class RollupOutbox {
  constructor(@InjectQueue(QUEUE_NAMES.ROLLUP) private readonly rollup: Queue<RollupJobData>) {}

  /** Asks for a pass. The pass claims its own rows, so a burst of evaluations is one job. */
  async relay(): Promise<void> {
    await this.rollup.add(
      ROLLUP_JOBS.FOLD_PENDING,
      {},
      { jobId: FOLD_PENDING_JOB_ID, delay: ROLLUP_FOLD_DELAY_MS, removeOnComplete: true },
    );
  }

  /** One id per test, dropped on completion: a retained one would swallow the next hour's rebuild. */
  async rebuild(testId: string): Promise<void> {
    await this.rollup.add(
      ROLLUP_JOBS.REBUILD_TEST,
      { testId },
      { jobId: rollupRebuildJobId(testId), delay: ROLLUP_REBUILD_DELAY_MS, removeOnComplete: true },
    );
  }

  /** One student's two tables, for a void that took a sitting out of their own history. */
  async rebuildStudent(studentId: string): Promise<void> {
    await this.rollup.add(
      ROLLUP_JOBS.REBUILD_STUDENT,
      { studentId },
      {
        jobId: rollupRebuildStudentJobId(studentId),
        delay: ROLLUP_REBUILD_DELAY_MS,
        removeOnComplete: true,
      },
    );
  }
}
