/**
 * A fact worth telling somebody about is INSERTED in the same transaction as the fact itself, so
 * the two commit together and no crash can leave a student untold. Handing it to the queue is a
 * separate, repeatable step — at-least-once, deduplicated by job id, landing once by dedupeKey.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import { type Prisma } from '@prisma/client';
import { type NotificationType } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import {
  NOTIFICATION_JOBS,
  QUEUE_NAMES,
  RELAY_BATCH,
  RELAY_GRACE_SEC,
  notificationJobId,
  type NotificationJobData,
} from '../queue/queues';

/** What one notification request is called in `OutboxEvent`. */
export const NOTIFICATION_REQUEST = {
  AGGREGATE_TYPE: 'Notification',
  EVENT_TYPE: 'notification.requested',
} as const;

/** What a pass did with one request: handed it on, gave up on it, or left it for the next sweep. */
const HANDLED = { SENT: 'sent', DROPPED: 'dropped', LEFT: 'left' } as const;

type Handled = (typeof HANDLED)[keyof typeof HANDLED];

const MILLISECONDS_PER_SECOND = 1000;

/** Everything the worker needs to write the row without the producer still being around. */
export interface NotificationIntent {
  studentId: string;
  type: NotificationType;
  title: string;
  body?: string;
  data?: Record<string, string | number>;
  dedupeKey?: string;
  actBy?: Date;
  testId?: string;
  testSeriesId?: string;
}

interface PendingRequest {
  id: string;
  payload: Prisma.JsonValue | null;
}

@Injectable()
export class NotificationOutbox {
  private readonly logger = new Logger(NotificationOutbox.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS)
    private readonly notifications: Queue<NotificationJobData>,
  ) {}

  /** Written with the caller's own transaction: the fact and the intent to tell about it commit together. */
  async request(tx: Prisma.TransactionClient, intent: NotificationIntent): Promise<string> {
    const row = await tx.outboxEvent.create({
      data: {
        aggregateType: NOTIFICATION_REQUEST.AGGREGATE_TYPE,
        aggregateId: intent.studentId,
        eventType: NOTIFICATION_REQUEST.EVENT_TYPE,
        payload: serialise(intent),
      },
      select: { id: true },
    });
    return row.id;
  }

  /** Several recipients of one announcement, written together so a partial fan-out cannot happen. */
  async requestMany(
    tx: Prisma.TransactionClient,
    intents: readonly NotificationIntent[],
  ): Promise<number> {
    if (intents.length === 0) return 0;

    await tx.outboxEvent.createMany({
      data: intents.map((intent) => ({
        aggregateType: NOTIFICATION_REQUEST.AGGREGATE_TYPE,
        aggregateId: intent.studentId,
        eventType: NOTIFICATION_REQUEST.EVENT_TYPE,
        payload: serialise(intent),
      })),
    });
    return intents.length;
  }

  /** One id straight after a write, or every request left pending when the sweeper runs. */
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

  private async pending(eventId?: string): Promise<PendingRequest[]> {
    const settling = new Date(Date.now() - RELAY_GRACE_SEC * MILLISECONDS_PER_SECOND);
    return this.prisma.outboxEvent.findMany({
      where: {
        eventType: NOTIFICATION_REQUEST.EVENT_TYPE,
        processedAt: null,
        // A writer hands its own on; a sweep waits, in case that writer is still committing.
        ...(eventId ? { id: eventId } : { createdAt: { lt: settling } }),
      },
      orderBy: { createdAt: 'asc' },
      take: RELAY_BATCH,
      select: { id: true, payload: true },
    });
  }

  /** Queued BEFORE it is marked, so a crash between the two redelivers rather than loses. */
  private async deliver(row: PendingRequest): Promise<Handled> {
    const intent = parseIntent(row.payload);
    try {
      if (intent === null) {
        // Marked anyway: a request nothing can ever act on would block every request behind it.
        this.logger.error(`Notification request ${row.id} carries no usable intent`);
      } else {
        await this.notifications.add(
          NOTIFICATION_JOBS.WRITE,
          { eventId: row.id },
          { jobId: notificationJobId(row.id) },
        );
      }
      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: { processedAt: new Date() },
      });
      return intent === null ? HANDLED.DROPPED : HANDLED.SENT;
    } catch (error) {
      // One request's failure is its own: it stays pending, and the next sweep hands it on again.
      this.logger.error(`Notification request ${row.id} could not be handed on`, error);
      return HANDLED.LEFT;
    }
  }
}

/** A Date does not survive JSON, so it goes as an instant and comes back as one. */
function serialise(intent: NotificationIntent): Prisma.InputJsonValue {
  return { ...intent, actBy: intent.actBy?.toISOString() } as Prisma.InputJsonValue;
}

/** Null for a payload this version cannot read, which is a dropped request rather than a crash. */
export function parseIntent(payload: Prisma.JsonValue | null): NotificationIntent | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const held = payload as Record<string, unknown>;
  if (typeof held.studentId !== 'string' || typeof held.title !== 'string') return null;
  if (typeof held.type !== 'string') return null;

  return {
    studentId: held.studentId,
    type: held.type as NotificationType,
    title: held.title,
    ...(typeof held.body === 'string' ? { body: held.body } : {}),
    ...(isVariables(held.data) ? { data: held.data } : {}),
    ...(typeof held.dedupeKey === 'string' ? { dedupeKey: held.dedupeKey } : {}),
    ...(typeof held.actBy === 'string' ? { actBy: new Date(held.actBy) } : {}),
    ...(typeof held.testId === 'string' ? { testId: held.testId } : {}),
    ...(typeof held.testSeriesId === 'string' ? { testSeriesId: held.testSeriesId } : {}),
  };
}

function isVariables(value: unknown): value is Record<string, string | number> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
