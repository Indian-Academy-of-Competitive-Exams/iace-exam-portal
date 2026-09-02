import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ATTEMPT_STATUS } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES, QUEUE_POLICY } from '../queue/queues';
import { AttemptStateService } from './attempt-state.service';
import { rowsToFlush } from './attempt-flush';

/** Redis to `AttemptQuestion` on a timer. A failed run costs the durable copy a minute, not answers. */
@Processor(QUEUE_NAMES.ATTEMPT_FLUSH, {
  concurrency: QUEUE_POLICY[QUEUE_NAMES.ATTEMPT_FLUSH].concurrency,
})
export class AttemptFlushProcessor extends WorkerHost {
  private readonly logger = new Logger(AttemptFlushProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: AttemptStateService,
  ) {
    super();
  }

  async process(): Promise<void> {
    for (const attemptId of await this.state.dirtyIds()) {
      // One attempt's failure is its own: the next one still gets its answers written.
      await this.flush(attemptId).catch((error: unknown) => {
        this.logger.error(`Flushing attempt ${attemptId} failed; it stays dirty`, error);
      });
    }
  }

  private async flush(attemptId: string): Promise<void> {
    const held = await this.state.read(attemptId);
    if (!held) {
      await this.state.clearDirty(attemptId);
      return;
    }

    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: { id: true, status: true },
    });
    // Submit writes its final answers around the flip, so anything ended is already durable.
    if (attempt?.status !== ATTEMPT_STATUS.IN_PROGRESS) {
      await this.state.clearDirty(attemptId);
      return;
    }

    const rows = rowsToFlush(held);
    if (rows.length > 0) {
      await this.prisma.$transaction(
        rows.map((row) =>
          this.prisma.attemptQuestion.updateMany({
            where: { attemptId, questionId: row.questionId },
            data: row.data,
          }),
        ),
      );
    }

    // Cleared last: a save landing mid-flush re-marks it, and the next run picks the newer state.
    await this.state.clearDirty(attemptId);
  }
}
