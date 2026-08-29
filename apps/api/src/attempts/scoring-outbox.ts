/**
 * Submitted implies scored. The request is INSERTED in the same transaction that flips a sitting
 * to SUBMITTED, so the two commit together and no crash can strand an attempt nobody scores.
 * Handing it to the queue is a separate, repeatable step — at-least-once, deduplicated by job id.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import { type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES, scoringJobId, type ScoringJobData } from '../queue/queues';

/** What one attempt's scoring request is called in `OutboxEvent`. */
export const SCORING_REQUEST = {
  AGGREGATE_TYPE: 'Attempt',
  EVENT_TYPE: 'attempt.scoring_requested',
} as const;

/** How many stranded requests one relay pass hands on. */
const RELAY_BATCH = 200;

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

  /** Written with the caller's own transaction: a SUBMITTED attempt always carries one of these. */
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

  /** One id straight after a submit, or every request left pending when the sweeper runs. */
  async relay(eventId?: string): Promise<number> {
    let handed = 0;
    for (;;) {
      const pending = await this.pending(eventId);
      let sent = 0;
      for (const row of pending) {
        sent += await this.deliver(row);
      }
      handed += sent;
      // Drains a backlog rather than 200 of it a sweep, and stops dead when nothing can be sent.
      if (pending.length < RELAY_BATCH || sent === 0) return handed;
    }
  }

  private async pending(eventId?: string): Promise<PendingRequest[]> {
    return this.prisma.outboxEvent.findMany({
      where: {
        eventType: SCORING_REQUEST.EVENT_TYPE,
        processedAt: null,
        ...(eventId ? { id: eventId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: RELAY_BATCH,
      select: { id: true, aggregateId: true, payload: true },
    });
  }

  /** Queued BEFORE it is marked, so a crash between the two redelivers rather than loses. */
  private async deliver(row: PendingRequest): Promise<number> {
    const testId = testIdOf(row.payload);
    if (!testId) {
      this.logger.error(`Scoring request ${row.id} carries no testId, so nothing can score it`);
      return 0;
    }

    try {
      await this.scoring.add(
        QUEUE_NAMES.SCORING,
        { attemptId: row.aggregateId, testId },
        { jobId: scoringJobId(row.aggregateId) },
      );
      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: { processedAt: new Date() },
      });
      return 1;
    } catch (error) {
      // One request's failure is its own: it stays pending, and the next sweep hands it on again.
      this.logger.error(`Handing scoring request ${row.id} to the queue failed`, error);
      return 0;
    }
  }
}

function testIdOf(payload: Prisma.JsonValue | null): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const testId = payload.testId;
  return typeof testId === 'string' ? testId : null;
}
