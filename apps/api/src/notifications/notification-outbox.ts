/**
 * A fact worth telling somebody about is INSERTED in the same transaction as the fact itself, so
 * the two commit together and no crash can leave a student untold. Handing it to the queue is a
 * separate, repeatable step — at-least-once, deduplicated by job id, landing once by dedupeKey.
 */
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import { type Prisma } from '@prisma/client';
import { type NotificationType } from '@iace/contracts';
import { type PaidChannel } from './notification-policy';
import {
  NOTIFICATION_JOBS,
  NOTIFICATION_WRITE_DELAY_MS,
  NOTIFICATION_WRITE_JOB_ID,
  QUEUE_NAMES,
  keyedJob,
  type NotificationJobData,
} from '../queue/queues';

/** What one notification request is called in `OutboxEvent`. */
export const NOTIFICATION_REQUEST = {
  AGGREGATE_TYPE: 'Notification',
  EVENT_TYPE: 'notification.requested',
} as const;

/** Everything the worker needs to write the row without the producer still being around. */
export interface NotificationIntent {
  studentId: string;
  type: NotificationType;
  title: string;
  body?: string;
  data?: Record<string, string | number>;
  dedupeKey?: string;
  announcementId?: string;
  escalate?: readonly PaidChannel[];
  actBy?: Date;
  testId?: string;
  testSeriesId?: string;
}

@Injectable()
export class NotificationOutbox {
  constructor(
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

  /** Asks for a pass. The pass claims its own rows, so a hall's worth of results is one job. */
  async relay(): Promise<void> {
    await this.notifications.add(
      NOTIFICATION_JOBS.WRITE_PENDING,
      {},
      {
        ...keyedJob(NOTIFICATION_WRITE_JOB_ID),
        delay: NOTIFICATION_WRITE_DELAY_MS,
        removeOnComplete: true,
      },
    );
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
    ...(typeof held.announcementId === 'string' ? { announcementId: held.announcementId } : {}),
    ...(Array.isArray(held.escalate) ? { escalate: held.escalate as PaidChannel[] } : {}),
    ...(typeof held.actBy === 'string' ? { actBy: new Date(held.actBy) } : {}),
    ...(typeof held.testId === 'string' ? { testId: held.testId } : {}),
    ...(typeof held.testSeriesId === 'string' ? { testSeriesId: held.testSeriesId } : {}),
  };
}

function isVariables(value: unknown): value is Record<string, string | number> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
