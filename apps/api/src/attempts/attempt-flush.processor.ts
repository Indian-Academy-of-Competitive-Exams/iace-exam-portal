import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_NAMES, QUEUE_POLICY } from '../queue/queues';
import { AttemptStateService } from './attempt-state.service';
import { AttemptSheetService } from './attempt-sheet.service';
import { type HeldState } from './attempt-state';
import { QueueFailures } from '../common/metrics/queue-failures';

/** How many sittings one pass writes at a time. Lanes, not workers: the flush queue runs one pass. */
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

  /** Bounded by the set as the pass found it, so a hall that keeps saving cannot keep one pass running. */
  async process(): Promise<void> {
    let left = await this.state.dirtyCount();
    while (left > 0) {
      const lane = await this.state.takeDirty(FLUSH_LANES);
      if (lane.length === 0) return;
      left -= lane.length;
      const held = await this.state.readMany(lane);
      const failed = await Promise.all(lane.map((id) => this.flush(id, held.get(id))));
      await this.state.markDirty(...failed.filter((id): id is string => id !== null));
    }
  }

  /** The id when its write failed, to go back on the list; null once written or gone. */
  private async flush(attemptId: string, held: HeldState | undefined): Promise<string | null> {
    // A key that has gone was taken by submit, which writes the final answers itself.
    if (!held) return null;
    try {
      await this.sheets.write(held, true);
      return null;
    } catch (error) {
      this.logger.error(
        `Flushing attempt ${attemptId} failed; it goes back for the next pass`,
        error,
      );
      return attemptId;
    }
  }
}
