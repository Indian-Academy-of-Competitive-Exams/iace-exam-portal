import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ATTEMPT_STATUS } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES, QUEUE_POLICY, SCORING_RETRY_AFTER_MS } from '../queue/queues';
import { isAbandoned, SAVE_GRACE_SEC } from './attempt-state';
import { AttemptStateService } from './attempt-state.service';
import { RollupQueue } from './rollup-queue';
import { SCORING_REQUEST, ScoringOutbox } from './scoring-outbox';
import { SubmitService } from './submit.service';
import { QueueFailures } from '../common/metrics/queue-failures';
import { MetricsService } from '../common/metrics/metrics.service';

/** Ends the sittings nobody ended, and hands on the scoring and counting nobody enqueued. */
@Processor(QUEUE_NAMES.ATTEMPT_SWEEP, {
  concurrency: QUEUE_POLICY[QUEUE_NAMES.ATTEMPT_SWEEP].concurrency,
})
export class AttemptSweeperProcessor extends WorkerHost {
  private readonly logger = new Logger(AttemptSweeperProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: AttemptStateService,
    private readonly submit: SubmitService,
    private readonly outbox: ScoringOutbox,
    private readonly rollup: RollupQueue,
    private readonly failures: QueueFailures,
    private readonly metrics: MetricsService,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.failures.record(QUEUE_NAMES.ATTEMPT_SWEEP, job, error);
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.failures.connectionError(QUEUE_NAMES.ATTEMPT_SWEEP, error);
  }

  async process(): Promise<void> {
    await this.endStranded();
    // The reconciler: a crash between the commit and the queue leaves a request nobody handed on.
    await this.outbox.relay().catch((error: unknown) => {
      this.logger.error('Relaying the scoring requests nobody handed on failed', error);
    });
    await this.rollup.sweep().catch((error: unknown) => {
      this.logger.error('Asking for the cohort counting pass failed', error);
    });
    await this.askAgainForUnscored().catch((error: unknown) => {
      this.logger.error('Asking again for the sittings nobody scored failed', error);
    });
  }

  /** Drains the backlog in one run: the cap bounds what a read holds, not what a sweep ends. */
  private async endStranded(): Promise<void> {
    for (;;) {
      const candidates = await this.expired();
      if (candidates.length === 0) return;

      const stranded = await this.abandoned(candidates);
      if (stranded.length === 0) return;

      let ended = 0;
      for (let at = 0; at < stranded.length; at += SWEEP_LANES) {
        const lane = await Promise.all(
          stranded.slice(at, at + SWEEP_LANES).map((attempt) => this.end(attempt.id)),
        );
        ended += lane.filter(Boolean).length;
      }
      // Stops on a batch nothing could end, which the next read would hand back unchanged forever.
      if (candidates.length < SWEEP_BATCH || ended === 0) return;
    }
  }

  /** A live key is a paper put down, and its TTL is the limit: having no key is the whole decision. */
  private async abandoned(candidates: readonly { id: string }[], now: Date = new Date()) {
    const held = await this.state.readMany(candidates.map((row) => row.id));
    return candidates.filter((row) => {
      const paused = held.get(row.id);
      return paused === undefined || isAbandoned(paused, now);
    });
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

  /** Two gaps the outbox alone can leave: an ended sitting never scored, or a re-score never landed. */
  private async askAgainForUnscored(now: Date = new Date()): Promise<void> {
    const settled = new Date(now.getTime() - SCORING_RETRY_AFTER_MS);
    // One count serves both jobs: the gauge queue depth cannot show, and how wide this pass re-asks.
    const backlog = await this.unscoredCount(settled);
    this.metrics.setScoringBacklog(backlog);
    await this.askAgain(
      settled,
      () => this.neverScored(settled, backlog),
      'ended unscored; asking for a score again',
    );
    await this.askAgain(
      settled,
      () => this.staleRescores(settled),
      'was re-scored but the correction never landed; asking again',
    );
  }

  /** Candidates from one arm, then their outbox rows: a request already in flight is never piled onto. */
  private async askAgain(
    settled: Date,
    candidatesOf: () => Promise<{ id: string; testId: string }[]>,
    why: string,
  ): Promise<void> {
    const candidates = await candidatesOf();
    if (candidates.length === 0) return;

    const requests = await this.prisma.outboxEvent.findMany({
      where: {
        eventType: SCORING_REQUEST.EVENT_TYPE,
        aggregateId: { in: candidates.map((attempt) => attempt.id) },
      },
      select: { aggregateId: true, processedAt: true },
    });
    // Still in flight, or handed on this window: a scorer already has it, so asking again piles up.
    const waiting = new Set(
      requests
        .filter((row) => row.processedAt === null || row.processedAt >= settled)
        .map((row) => row.aggregateId),
    );

    for (const attempt of candidates.filter((row) => !waiting.has(row.id))) {
      await this.outbox.request(this.prisma, attempt);
      this.logger.warn(`Attempt ${attempt.id} ${why}`);
    }
  }

  /** The gauge's own read, and the width of the batch below — both the same predicate, one query. */
  private unscoredCount(settled: Date): Promise<number> {
    return this.prisma.attempt.count({
      where: { status: ATTEMPT_STATUS.SUBMITTED, score: null, submittedAt: { lt: settled } },
    });
  }

  /** A job that exhausted its retries left an ended sitting with no score, and nothing owned it. */
  private neverScored(settled: Date, backlog: number): Promise<{ id: string; testId: string }[]> {
    if (backlog === 0) return Promise.resolve([]);
    return this.prisma.attempt.findMany({
      where: { status: ATTEMPT_STATUS.SUBMITTED, score: null, submittedAt: { lt: settled } },
      orderBy: { submittedAt: 'asc' },
      // Caps one sweep's own sequential re-requests, not the scoring queue, which drains at its own pace.
      take: Math.min(backlog, NEVER_SCORED_BATCH_CEILING),
      select: { id: true, testId: true },
    });
  }

  /** An EVALUATED sitting whose last mark predates its own re-score request: the correction never ran. */
  // Scans a week of relayed requests, not all of them: the outbox prune drops anything older.
  private async staleRescores(settled: Date): Promise<{ id: string; testId: string }[]> {
    const rows = await this.prisma.$queryRaw<{ id: string; testId: string }[]>`
      SELECT a."id", a."testId"
      FROM "OutboxEvent" o
      JOIN "Attempt" a
        ON a."id" = o."aggregateId"
       AND a."status" = ${ATTEMPT_STATUS.EVALUATED}::"AttemptStatus"
       AND a."updatedAt" < o."createdAt"
      WHERE o."aggregateType" = ${SCORING_REQUEST.AGGREGATE_TYPE}
        AND o."eventType" = ${SCORING_REQUEST.EVENT_TYPE}
        AND o."processedAt" < ${settled}
      ORDER BY o."processedAt" ASC
      LIMIT ${RESCORE_BATCH}`;
    return [...new Map(rows.map((row) => [row.id, row])).values()];
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

/** How many stale rescores one sweep asks about — a rare correction path, not a backlog drain. */
const RESCORE_BATCH = 100;

/** The never-scored arm's own ceiling: wide enough to drain 6,000 in minutes, not hours. */
export const NEVER_SCORED_BATCH_CEILING = 1000;

/** How many stranded sittings one read holds. A sweep keeps reading until the backlog is gone. */
export const SWEEP_BATCH = 200;

/** Ended side by side rather than one after another; the last student waited for all of them. */
export const SWEEP_LANES = 8;
