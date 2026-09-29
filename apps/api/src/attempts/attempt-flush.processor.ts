import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_NAMES, QUEUE_POLICY } from '../queue/queues';
import { AttemptSheetService } from './attempt-sheet.service';
import { AttemptStateService, type FlushRead } from './attempt-state.service';
import { QueueFailures } from '../common/metrics/queue-failures';

/** How many sittings one pass writes at a time. Lanes, not workers: one pass owns the dirty set. */
export const FLUSH_LANES = 8;

/** Redis to the sitting's sheet on a timer. A failed run costs the durable copy a minute, not answers. */
@Processor(QUEUE_NAMES.ATTEMPT_FLUSH, {
  concurrency: QUEUE_POLICY[QUEUE_NAMES.ATTEMPT_FLUSH].concurrency,
})
export class AttemptFlushProcessor extends WorkerHost {
  private readonly logger = new Logger(AttemptFlushProcessor.name);

  constructor(
    private readonly state: AttemptStateService,
    private readonly sheets: AttemptSheetService,
    private readonly failures: QueueFailures,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.failures.record(QUEUE_NAMES.ATTEMPT_FLUSH, job, error);
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.failures.connectionError(QUEUE_NAMES.ATTEMPT_FLUSH, error);
  }

  /** The set as the pass found it; a mark goes only after its sitting is written, so a pass that dies loses none. */
  async process(): Promise<void> {
    const dirty = await this.state.dirtyIds();
    for (let at = 0; at < dirty.length; at += FLUSH_LANES) {
      const lane = await this.state.snapshot(dirty.slice(at, at + FLUSH_LANES));
      const written = await Promise.all(lane.map((sitting) => this.flush(sitting)));
      await this.state.settle(written.filter((sitting): sitting is FlushRead => sitting !== null));
    }
  }

  /** The sitting once written, or with nothing left to write; null when the write failed, to stay marked. */
  private async flush(sitting: FlushRead): Promise<FlushRead | null> {
    // No key: submit took it and wrote the last answers itself, or it outlived the pause limit.
    if (!sitting.held) return sitting;
    try {
      await this.sheets.write(sitting.held, true);
      return sitting;
    } catch (error) {
      this.logger.error(`Flushing attempt ${sitting.attemptId} failed; it stays marked`, error);
      return null;
    }
  }
}
