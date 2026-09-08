import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ATTEMPT_STATUS } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES, QUEUE_POLICY, SCORING_RETRY_AFTER_MS } from '../queue/queues';
import { SAVE_GRACE_SEC } from './attempt-state';
import { RollupOutbox } from './rollup-outbox';
import { SCORING_REQUEST, ScoringOutbox } from './scoring-outbox';
import { SubmitService } from './submit.service';

/** Ends the sittings nobody ended, and hands on the scoring and counting nobody enqueued. */
@Processor(QUEUE_NAMES.ATTEMPT_SWEEP, {
  concurrency: QUEUE_POLICY[QUEUE_NAMES.ATTEMPT_SWEEP].concurrency,
})
export class AttemptSweeperProcessor extends WorkerHost {
  private readonly logger = new Logger(AttemptSweeperProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly submit: SubmitService,
    private readonly outbox: ScoringOutbox,
    private readonly rollup: RollupOutbox,
  ) {
    super();
  }

  async process(): Promise<void> {
    await this.endStranded();
    // The reconciler: a crash between the commit and the queue leaves a request nobody handed on.
    await this.outbox.relay().catch((error: unknown) => {
      this.logger.error('Relaying the scoring requests nobody handed on failed', error);
    });
    await this.rollup.relay().catch((error: unknown) => {
      this.logger.error('Relaying the evaluations nobody counted failed', error);
    });
    await this.askAgainForUnscored().catch((error: unknown) => {
      this.logger.error('Asking again for the sittings nobody scored failed', error);
    });
  }

  /** Drains the backlog in one run: the cap bounds what a read holds, not what a sweep ends. */
  private async endStranded(): Promise<void> {
    for (;;) {
      const stranded = await this.expired();
      if (stranded.length === 0) return;

      let ended = 0;
      for (let at = 0; at < stranded.length; at += SWEEP_LANES) {
        const lane = await Promise.all(
          stranded.slice(at, at + SWEEP_LANES).map((attempt) => this.end(attempt.id)),
        );
        ended += lane.filter(Boolean).length;
      }
      // Stops on a batch nothing could end, which the next read would hand back unchanged forever.
      if (stranded.length < SWEEP_BATCH || ended === 0) return;
    }
  }

  /** Through the same gate the student uses, so a race resolves to one submission. */
  private async end(attemptId: string): Promise<boolean> {
    try {
      await this.submit.expire(attemptId);
      return true;
    } catch (error: unknown) {
      this.logger.error(`Sweeping attempt ${attemptId} failed`, error);
      return false;
    }
  }

  /** A job that exhausted its retries left an ended sitting with no score, and nothing owned it. */
  private async askAgainForUnscored(now: Date = new Date()): Promise<void> {
    const settled = new Date(now.getTime() - SCORING_RETRY_AFTER_MS);
    const stranded = await this.prisma.attempt.findMany({
      where: {
        status: ATTEMPT_STATUS.SUBMITTED,
        score: null,
        submittedAt: { lt: settled },
      },
      orderBy: { submittedAt: 'asc' },
      take: RESCORE_BATCH,
      select: { id: true, testId: true },
    });
    if (stranded.length === 0) return;

    const requests = await this.prisma.outboxEvent.findMany({
      where: {
        eventType: SCORING_REQUEST.EVENT_TYPE,
        aggregateId: { in: stranded.map((attempt) => attempt.id) },
      },
      select: { aggregateId: true, processedAt: true },
    });
    // Still in flight, or handed on this window: a scorer already has it, so asking again piles up.
    const waiting = new Set(
      requests
        .filter((row) => row.processedAt === null || row.processedAt >= settled)
        .map((row) => row.aggregateId),
    );

    for (const attempt of stranded.filter((row) => !waiting.has(row.id))) {
      await this.outbox.request(this.prisma, attempt);
      this.logger.warn(`Attempt ${attempt.id} ended unscored; asking for a score again`);
    }
  }

  /** The same grace a save gets, so the sweeper never ends a sitting a save could still reach. */
  private async expired(now: Date = new Date()) {
    const cutoff = new Date(now.getTime() - SAVE_GRACE_SEC * MILLISECONDS_PER_SECOND);
    return this.prisma.attempt.findMany({
      where: { status: ATTEMPT_STATUS.IN_PROGRESS, endsAt: { lt: cutoff } },
      select: { id: true },
      take: SWEEP_BATCH,
    });
  }
}

const MILLISECONDS_PER_SECOND = 1000;

/** How many stranded sittings one sweep asks about. The next sweep takes the rest. */
const RESCORE_BATCH = 100;

/** How many stranded sittings one read holds. A sweep keeps reading until the backlog is gone. */
export const SWEEP_BATCH = 200;

/** Ended side by side rather than one after another; the last student waited for all of them. */
export const SWEEP_LANES = 8;
