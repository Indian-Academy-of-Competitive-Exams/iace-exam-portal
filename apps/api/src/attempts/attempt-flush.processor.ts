import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES, QUEUE_POLICY } from '../queue/queues';
import { AttemptStateService } from './attempt-state.service';
import { type HeldState } from './attempt-state';
import { FLUSH_LANES, STILL_LIVE, rowsToFlush, writeRows } from './attempt-flush';
import { QueueFailures } from '../common/metrics/queue-failures';

/** Redis to `AttemptQuestion` on a timer. A failed run costs the durable copy a minute, not answers. */
@Processor(QUEUE_NAMES.ATTEMPT_FLUSH, {
  concurrency: QUEUE_POLICY[QUEUE_NAMES.ATTEMPT_FLUSH].concurrency,
})
export class AttemptFlushProcessor extends WorkerHost {
  private readonly logger = new Logger(AttemptFlushProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: AttemptStateService,
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
    const written = held.pending ?? Object.keys(held.answers);
    try {
      // Gated rather than asked: an ended sitting matches no rows, so its status costs no query.
      await writeRows(this.prisma, attemptId, rowsToFlush(held, written), STILL_LIVE);
      await this.state.clearPending(attemptId, written);
      return attemptId;
    } catch (error) {
      this.logger.error(`Flushing attempt ${attemptId} failed; it stays dirty`, error);
      return null;
    }
  }
}
