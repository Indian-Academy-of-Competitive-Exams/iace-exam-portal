/**
 * Asking for a score. Every ask is keyed and BullMQ holds one job per id, so asking twice is asking
 * once: a first score under the sitting's id, a re-score under the sitting's id and the paper
 * revision it is asked against. Both are asked again by the sweeper for as long as the state that
 * asked for them lasts — ended and unscored, or marked against an older paper than the test's.
 */
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import {
  QUEUE_NAMES,
  keyedJob,
  rescoreJobId,
  scoringJobId,
  type ScoringJobData,
} from '../queue/queues';

interface Sitting {
  id: string;
  testId: string;
}

@Injectable()
export class ScoringQueue {
  constructor(@InjectQueue(QUEUE_NAMES.SCORING) private readonly scoring: Queue<ScoringJobData>) {}

  async queue(attempts: readonly Sitting[]): Promise<void> {
    await this.add(attempts.map((attempt) => [attempt, scoringJobId(attempt.id)]));
  }

  async rescore(attempts: readonly (Sitting & { revision: number })[]): Promise<void> {
    await this.add(
      attempts.map((attempt) => [attempt, rescoreJobId(attempt.id, attempt.revision)]),
    );
  }

  private async add(jobs: readonly (readonly [Sitting, string])[]): Promise<void> {
    if (jobs.length === 0) return;
    await this.scoring.addBulk(
      jobs.map(([attempt, jobId]) => ({
        name: QUEUE_NAMES.SCORING,
        data: { attemptId: attempt.id, testId: attempt.testId },
        opts: keyedJob(jobId),
      })),
    );
  }
}
