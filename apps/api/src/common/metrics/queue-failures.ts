/**
 * The only place a job that ran out of attempts is heard from. Nothing retains it: a keyed id
 * cannot keep its failure without swallowing every later add under the same id.
 */
import { Injectable, Logger } from '@nestjs/common';
import { type Job } from 'bullmq';
import { type QueueName } from '../../queue/queues';
import { MetricsService } from './metrics.service';

@Injectable()
export class QueueFailures {
  private readonly logger = new Logger(QueueFailures.name);

  constructor(private readonly metrics: MetricsService) {}

  /** A job BullMQ could not even load reads as spent: there are no attempts left to count. */
  record(queue: QueueName, job: Job | undefined, error: Error): void {
    const spent = job === undefined || job.attemptsMade >= (job.opts.attempts ?? 1);
    this.metrics.countQueueFailure(queue, spent);

    const named = `${queue} job ${job?.id ?? 'unknown'}`;
    if (spent) this.logger.error(`${named} failed for the last time and is gone`, error.stack);
    else this.logger.warn(`${named} failed and will be tried again: ${error.message}`);
  }
}
