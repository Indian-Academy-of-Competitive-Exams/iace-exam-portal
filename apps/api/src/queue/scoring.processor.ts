import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job } from 'bullmq';
import { QUEUE_NAMES, type ScoringJobData } from './queues';

/** Placeholder scoring worker. */
@Processor(QUEUE_NAMES.SCORING)
export class ScoringProcessor extends WorkerHost {
  private readonly logger = new Logger(ScoringProcessor.name);

  async process(job: Job<ScoringJobData>): Promise<void> {
    this.logger.log(`Scoring job ${job.id} received for attempt ${job.data.attemptId} (no-op)`);
  }
}
