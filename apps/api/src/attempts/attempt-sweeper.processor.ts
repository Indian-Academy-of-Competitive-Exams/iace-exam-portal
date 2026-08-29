import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ATTEMPT_STATUS } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES } from '../queue/queues';
import { SAVE_GRACE_SEC } from './attempt-state';
import { ScoringOutbox } from './scoring-outbox';
import { SubmitService } from './submit.service';

/** Ends the sittings nobody ended, and hands on the scoring nobody managed to enqueue. */
@Processor(QUEUE_NAMES.ATTEMPT_SWEEP)
export class AttemptSweeperProcessor extends WorkerHost {
  private readonly logger = new Logger(AttemptSweeperProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly submit: SubmitService,
    private readonly outbox: ScoringOutbox,
  ) {
    super();
  }

  async process(): Promise<void> {
    for (const attempt of await this.expired()) {
      // Through the same gate the student uses, so a race resolves to one submission.
      await this.submit.expire(attempt.id).catch((error: unknown) => {
        this.logger.error(`Sweeping attempt ${attempt.id} failed`, error);
      });
    }
    // The reconciler: a crash between the commit and the queue leaves a request nobody handed on.
    await this.outbox.relay().catch((error: unknown) => {
      this.logger.error('Relaying the scoring requests nobody handed on failed', error);
    });
  }

  /** The same grace a save gets, so the sweeper never ends a sitting a save could still reach. */
  private async expired(now: Date = new Date()) {
    const cutoff = new Date(now.getTime() - SAVE_GRACE_SEC * MILLISECONDS_PER_SECOND);
    return this.prisma.attempt.findMany({
      where: { status: ATTEMPT_STATUS.IN_PROGRESS, endsAt: { lt: cutoff } },
      select: { id: true },
    });
  }
}

const MILLISECONDS_PER_SECOND = 1000;
