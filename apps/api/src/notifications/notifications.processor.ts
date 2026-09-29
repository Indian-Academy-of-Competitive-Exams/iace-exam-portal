/**
 * Pushes what producers have written. A producer writes the bell row inside its own transaction;
 * this sweep claims the rows nobody has pushed yet, books the paid chain an announcement chose,
 * queues it behind the grace window, and only then pushes — the free channel is best effort.
 */
import { Injectable } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job, type Queue } from 'bullmq';
import { DeliveryStatus } from '@prisma/client';
import { type NotificationType } from '@iace/contracts';
import { PrismaService, TX_LIMITS } from '../prisma/prisma.service';
import {
  NOTIFICATION_JOBS,
  RELAY_BATCH,
  QUEUE_NAMES,
  QUEUE_POLICY,
  keyedJob,
  notificationDeliveryJobId,
  type NotificationDeliveryJobData,
} from '../queue/queues';
import {
  PAID_CHANNELS,
  escalationFor,
  firstChannelFor,
  type PaidChannel,
} from './notification-policy';
import { PushService } from './push.service';
import { NotificationDeliveryProcessor } from './notification-delivery.processor';
import { TestOpeningService } from './test-opening.service';
import { QueueFailures } from '../common/metrics/queue-failures';
import { MS_PER_SECOND } from '../common/time/units';

/** A bound on one pass, so a backlog is drained by several jobs rather than one that never ends. */
const PUSH_PAGES_PER_PASS = 25;

/** A claimed row, with the chain its announcement chose beside it — empty for everything else. */
interface Claimed {
  id: string;
  studentId: string | null;
  type: NotificationType;
  title: string;
  actBy: Date | null;
  paidChannels: PaidChannel[] | null;
}

@Injectable()
@Processor(QUEUE_NAMES.NOTIFICATIONS, {
  concurrency: QUEUE_POLICY[QUEUE_NAMES.NOTIFICATIONS].concurrency,
})
export class NotificationsProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly openings: TestOpeningService,
    private readonly deliveryRepair: NotificationDeliveryProcessor,
    @InjectQueue(QUEUE_NAMES.NOTIFICATION_DELIVERY)
    private readonly deliveries: Queue<NotificationDeliveryJobData>,
    private readonly failures: QueueFailures,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.failures.record(QUEUE_NAMES.NOTIFICATIONS, job, error);
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.failures.connectionError(QUEUE_NAMES.NOTIFICATIONS, error);
  }

  async process(job: Job): Promise<void> {
    if (job.name === NOTIFICATION_JOBS.TESTS_OPENED) {
      await this.openings.sweep();
      return;
    }
    // The sweep, or a write job queued before this deploy: either way the rows are already written.
    await this.pushPending();
    if (job.name === NOTIFICATION_JOBS.SWEEP) await this.deliveryRepair.repairStalled();
  }

  /** One pass drains what it finds: a page at a time, so a backlog does not wait out a sweep each. */
  async pushPending(): Promise<number> {
    let pushed = 0;
    for (let page = 0; page < PUSH_PAGES_PER_PASS; page += 1) {
      const claimed = await this.pushPage();
      pushed += claimed;
      if (claimed < RELAY_BATCH) break;
    }
    return pushed;
  }

  private async pushPage(): Promise<number> {
    const rows = await this.claimPage();
    if (rows.length === 0) return 0;

    await this.schedule(rows);
    await this.push.deliverAll(
      rows.flatMap((row) =>
        row.studentId === null
          ? []
          : [
              {
                notificationId: row.id,
                studentId: row.studentId,
                type: row.type,
                title: row.title,
              },
            ],
      ),
    );
    return rows.length;
  }

  /** Claimed and booked together, so a row is never pushed twice nor left with its paid chain unbooked. */
  private claimPage(): Promise<Claimed[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Claimed[]>`
        WITH claimed AS (
          UPDATE "Notification" SET "pushedAt" = now()
          WHERE "id" IN (
            SELECT "id" FROM "Notification" WHERE "pushedAt" IS NULL
            ORDER BY "createdAt" LIMIT ${RELAY_BATCH}
            FOR UPDATE SKIP LOCKED)
          RETURNING "id", "studentId", "type", "title", "actBy", "announcementId")
        SELECT c."id", c."studentId", c."type"::text AS "type", c."title", c."actBy",
          a."paidChannels"::text[] AS "paidChannels"
        FROM claimed c LEFT JOIN "Announcement" a ON a."id" = c."announcementId"`;

      // Only the FIRST: the rest are what a terminal failure falls back to, not a second send.
      const firsts = rows.flatMap((row) => {
        const channel = firstChannelFor(row.paidChannels ?? []);
        return channel ? [{ notificationId: row.id, channel }] : [];
      });
      await tx.notificationDelivery.createMany({ data: firsts, skipDuplicates: true });
      return rows;
    }, TX_LIMITS.SHORT);
  }

  /** The grace window: the free channels get this long before a paid one is bought. */
  private async schedule(rows: readonly Claimed[]): Promise<void> {
    const paid = new Map(
      rows.filter((row) => (row.paidChannels?.length ?? 0) > 0).map((row) => [row.id, row]),
    );
    if (paid.size === 0) return;

    // The BOOKED rows are the truth about what may be spent; policy only says how long to wait.
    const booked = await this.prisma.notificationDelivery.findMany({
      where: {
        notificationId: { in: [...paid.keys()] },
        status: DeliveryStatus.PENDING,
        channel: { in: PAID_CHANNELS },
      },
      select: { id: true, notificationId: true },
    });

    const now = new Date();
    for (const row of booked) {
      const notification = paid.get(row.notificationId);
      const plan = escalationFor(
        notification?.actBy ?? null,
        now,
        notification?.paidChannels ?? [],
      );
      await this.deliveries.add(
        QUEUE_NAMES.NOTIFICATION_DELIVERY,
        { deliveryId: row.id },
        // Keyed on the row, so a swept-again notification schedules the same job rather than a second buy.
        {
          ...keyedJob(notificationDeliveryJobId(row.id)),
          delay: plan.deferSec * MS_PER_SECOND,
        },
      );
    }
  }
}
