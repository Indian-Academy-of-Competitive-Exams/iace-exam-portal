// Nest's metadata scan walks the prototype CHAIN (MetadataScanner.scanFromPrototype), so the two
// listeners below are discovered on a subclass and every processor stops restating them.
import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { type Job } from 'bullmq';
import { QueueFailures } from '../common/metrics/queue-failures';
import { type QueueName } from './queues';

/** A worker whose failures are counted and logged: the queue's name is all a processor adds. */
export abstract class ReportingWorkerHost extends WorkerHost {
  protected constructor(
    private readonly queue: QueueName,
    private readonly failures: QueueFailures,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.failures.record(this.queue, job, error);
  }

  /** A worker's own connection fault, which belongs to no job. */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.failures.connectionError(this.queue, error);
  }
}
