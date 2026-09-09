/**
 * Evaluated implies counted. The `scoring.completed` row is INSERTED in the same transaction that
 * claims the first evaluation, so the two commit together and no crash can strand a sitting the
 * aggregates never saw. Handing it to the queue is a separate, repeatable step.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { DOMAIN_EVENTS } from '../common/events';
import {
  QUEUE_NAMES,
  RELAY_BATCH,
  RELAY_GRACE_SEC,
  ROLLUP_JOBS,
  ROLLUP_REBUILD_DELAY_MS,
  rollupJobId,
  rollupRebuildJobId,
  rollupRebuildStudentJobId,
  type RollupJobData,
} from '../queue/queues';

/** What one evaluation's fold request is called in `OutboxEvent`. */
export const ROLLUP_REQUEST = {
  AGGREGATE_TYPE: 'Attempt',
  EVENT_TYPE: DOMAIN_EVENTS.SCORING_COMPLETED,
} as const;

/** What a pass did with one event: handed it on, or left it for the next sweep. */
const HANDLED = { SENT: 'sent', LEFT: 'left' } as const;

type Handled = (typeof HANDLED)[keyof typeof HANDLED];

@Injectable()
export class RollupOutbox {
  private readonly logger = new Logger(RollupOutbox.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.ROLLUP) private readonly rollup: Queue<RollupJobData>,
  ) {}

  /** One id straight after an evaluation, or every fold left pending when the sweeper runs. */
  async relay(eventId?: string): Promise<number> {
    let handed = 0;
    for (;;) {
      const pending = await this.pending(eventId);
      const outcomes: Handled[] = [];
      for (const row of pending) {
        outcomes.push(await this.deliver(row));
      }
      handed += outcomes.filter((outcome) => outcome === HANDLED.SENT).length;

      // Drains a backlog rather than 200 of it a sweep, and stops on a queue nobody can reach.
      const stuck = outcomes.every((outcome) => outcome === HANDLED.LEFT);
      if (pending.length < RELAY_BATCH || stuck) return handed;
    }
  }

  /** One id per test, dropped on completion: a retained one would swallow the next hour's rebuild. */
  async rebuild(testId: string): Promise<void> {
    await this.rollup.add(
      ROLLUP_JOBS.REBUILD_TEST,
      { testId },
      { jobId: rollupRebuildJobId(testId), delay: ROLLUP_REBUILD_DELAY_MS, removeOnComplete: true },
    );
  }

  /** One student's two tables, for a void that took a sitting out of their own history. */
  async rebuildStudent(studentId: string): Promise<void> {
    await this.rollup.add(
      ROLLUP_JOBS.REBUILD_STUDENT,
      { studentId },
      {
        jobId: rollupRebuildStudentJobId(studentId),
        delay: ROLLUP_REBUILD_DELAY_MS,
        removeOnComplete: true,
      },
    );
  }

  private async pending(eventId?: string): Promise<{ id: string; aggregateId: string }[]> {
    const settling = new Date(Date.now() - RELAY_GRACE_SEC * MILLISECONDS_PER_SECOND);
    return this.prisma.outboxEvent.findMany({
      where: {
        eventType: ROLLUP_REQUEST.EVENT_TYPE,
        processedAt: null,
        // The scorer hands on its own; a sweep waits, in case the commit is still settling.
        ...(eventId ? { id: eventId } : { createdAt: { lt: settling } }),
      },
      orderBy: { createdAt: 'asc' },
      take: RELAY_BATCH,
      select: { id: true, aggregateId: true },
    });
  }

  /** Queued BEFORE it is marked, so a crash between the two redelivers rather than loses. */
  private async deliver(row: { id: string; aggregateId: string }): Promise<Handled> {
    try {
      await this.rollup.add(
        ROLLUP_JOBS.FOLD,
        { attemptId: row.aggregateId },
        { jobId: rollupJobId(row.id) },
      );
      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: { processedAt: new Date() },
      });
      return HANDLED.SENT;
    } catch (error) {
      // One event's failure is its own: it stays pending, and the next sweep hands it on again.
      this.logger.error(`Handing rollup event ${row.id} to the queue failed`, error);
      return HANDLED.LEFT;
    }
  }
}

const MILLISECONDS_PER_SECOND = 1000;
