import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_NAMES, QUEUE_POLICY } from '../queue/queues';
import { AttemptStateService } from './attempt-state.service';
import { AttemptSheetService } from './attempt-sheet.service';
import { type HeldState } from './attempt-state';
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

  /** One pass owns the dirty set, so the lanes below are its own and never a second worker's. */
  async process(): Promise<void> {
    const dirty = await this.state.dirtyIds();

    for (let at = 0; at < dirty.length; at += FLUSH_LANES) {
      const lane = dirty.slice(at, at + FLUSH_LANES);
      const held = await this.state.readMany(lane);
      const done = await Promise.all(lane.map((id) => this.flush(id, held.get(id))));
      await this.state.clearDirty(...done.filter((id): id is string => id !== null));
    }
  }

  /** The id once it is written, or null to leave it dirty for the next pass to try again. */
  private async flush(attemptId: string, held: HeldState | undefined): Promise<string | null> {
    // A key that has gone was taken by submit, which writes the final answers itself.
    if (!held) return attemptId;

    // No list means a key written before this shipped, whose whole paper is still the safe write.
    const ids = held.pending ?? Object.keys(held.answers);
    const written = Object.fromEntries(
      ids.flatMap((id) => {
        const answer = held.answers[id];
        return answer ? [[id, answer] as const] : [];
      }),
    );
    try {
      await this.sheets.patch(held, ids);
      await this.state.clearPending(attemptId, written);
      return attemptId;
    } catch (error) {
      this.logger.error(`Flushing attempt ${attemptId} failed; it stays dirty`, error);
      return null;
    }
  }
}
