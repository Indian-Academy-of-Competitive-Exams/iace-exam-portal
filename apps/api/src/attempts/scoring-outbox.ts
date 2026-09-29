/**
 * Asking for a score. A submitted sitting is its own request: queued under its own id, and queued
 * again by the sweeper while it stays unscored — BullMQ holds one job per id, so asking twice is
 * asking once. A re-score has no such state to find, so it alone is written as an outbox row in
 * the transaction that caused it, and handed on by the sweeper.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import { type Prisma } from '@prisma/client';
import { ATTEMPT_STATUS, type AttemptStatus } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import {
  QUEUE_NAMES,
  RELAY_BATCH,
  RELAY_GRACE_SEC,
  keyedJob,
  scoringJobId,
  type ScoringJobData,
} from '../queue/queues';
import { MS_PER_SECOND } from '../common/time/units';

/** What one attempt's scoring request is called in `OutboxEvent`. */
export const SCORING_REQUEST = {
  AGGREGATE_TYPE: 'Attempt',
  EVENT_TYPE: 'attempt.scoring_requested',
} as const;

/** Sittings a re-score can still reach. One still in progress will be scored when it ends. */
const ENDED: readonly AttemptStatus[] = [ATTEMPT_STATUS.SUBMITTED, ATTEMPT_STATUS.EVALUATED];

interface PendingRequest {
  id: string;
  aggregateId: string;
  payload: Prisma.JsonValue | null;
}

@Injectable()
export class ScoringOutbox {
  private readonly logger = new Logger(ScoringOutbox.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.SCORING) private readonly scoring: Queue<ScoringJobData>,
  ) {}

  /** Each sitting under its own id: a job the queue still holds swallows the second ask. */
  async queue(attempts: readonly { id: string; testId: string }[]): Promise<void> {
    if (attempts.length === 0) return;
    await this.scoring.addBulk(
      attempts.map((attempt) => ({
        name: QUEUE_NAMES.SCORING,
        data: { attemptId: attempt.id, testId: attempt.testId },
        opts: keyedJob(scoringJobId(attempt.id)),
      })),
    );
  }

  /** A re-score asked for again: written with the caller's own transaction. */
  async request(
    tx: Prisma.TransactionClient,
    attempt: { id: string; testId: string },
  ): Promise<string> {
    const row = await tx.outboxEvent.create({
      data: {
        aggregateType: SCORING_REQUEST.AGGREGATE_TYPE,
        aggregateId: attempt.id,
        eventType: SCORING_REQUEST.EVENT_TYPE,
        payload: { testId: attempt.testId },
      },
      select: { id: true },
    });
    return row.id;
  }

  /** Written with the caller's transaction: a drop and its re-scores commit together or not. */
  async rescore(tx: Prisma.TransactionClient, testId: string): Promise<number> {
    // Every sitting of a test was served its whole paper, so every ended one is reached.
    const sittings = await tx.attempt.findMany({
      where: { testId, status: { in: [...ENDED] } },
      select: { id: true },
    });
    if (sittings.length === 0) return 0;

    await tx.outboxEvent.createMany({
      data: sittings.map((row) => ({
        aggregateType: SCORING_REQUEST.AGGREGATE_TYPE,
        aggregateId: row.id,
        eventType: SCORING_REQUEST.EVENT_TYPE,
        payload: { testId },
      })),
    });
    return sittings.length;
  }

  /** Every re-score request left pending past its grace, when the sweeper runs. */
  async relay(): Promise<number> {
    let handed = 0;
    for (;;) {
      const pending = await this.pending();
      const sent = await this.deliver(pending);
      // Drains a backlog rather than 200 of it a sweep, and stops on a queue nobody can reach.
      if (sent === null) return handed;
      handed += sent;
      if (pending.length < RELAY_BATCH) return handed;
    }
  }

  private async pending(): Promise<PendingRequest[]> {
    const settling = new Date(Date.now() - RELAY_GRACE_SEC * MS_PER_SECOND);
    return this.prisma.outboxEvent.findMany({
      where: {
        eventType: SCORING_REQUEST.EVENT_TYPE,
        processedAt: null,
        // Past its grace, so the transaction that wrote it has settled everything it re-scores.
        createdAt: { lt: settling },
      },
      orderBy: { createdAt: 'asc' },
      take: RELAY_BATCH,
      select: { id: true, aggregateId: true, payload: true },
    });
  }

  /** Queued BEFORE they are marked, so a crash between the two redelivers rather than loses. */
  private async deliver(rows: PendingRequest[]): Promise<number | null> {
    if (rows.length === 0) return 0;
    const jobs = rows.flatMap((row) => {
      const testId = testIdOf(row.payload);
      // Marked with the rest: left pending, a request nothing can act on blocks every one behind it.
      if (testId === null) {
        this.logger.error(`Scoring request ${row.id} names no test, so nothing can score it`);
        return [];
      }
      const data = { attemptId: row.aggregateId, testId };
      return [{ name: QUEUE_NAMES.SCORING, data, opts: keyedJob(scoringJobId(row.id)) }];
    });
    try {
      if (jobs.length > 0) await this.scoring.addBulk(jobs);
      await this.prisma.outboxEvent.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: { processedAt: new Date() },
      });
      return jobs.length;
    } catch (error) {
      // The page stays pending, and the next sweep hands it on again.
      this.logger.error(`Handing ${rows.length} scoring requests to the queue failed`, error);
      return null;
    }
  }
}

function testIdOf(payload: Prisma.JsonValue | null): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const testId = payload.testId;
  return typeof testId === 'string' ? testId : null;
}
