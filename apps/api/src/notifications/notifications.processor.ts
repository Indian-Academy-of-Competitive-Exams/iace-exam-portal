/**
 * Pushes what producers have written. A producer writes the bell row inside its own transaction;
 * this sweep claims the rows nobody has pushed yet and books the paid chain an announcement chose,
 * then pushes and queues that chain behind the grace window. A booking the queue never got is
 * found by `repairStalled`, which runs after the free pushes however the pass ended.
 */
import { Injectable } from '@nestjs/common';
import { InjectQueue, Processor } from '@nestjs/bullmq';
import { ReportingWorkerHost } from '../queue/reporting-worker-host';
import { type Job, type Queue } from 'bullmq';
import { DeliveryStatus } from '@prisma/client';
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
  title: string;
  actBy: Date | null;
  paidChannels: PaidChannel[] | null;
}

@Injectable()
@Processor(QUEUE_NAMES.NOTIFICATIONS, {
  concurrency: QUEUE_POLICY[QUEUE_NAMES.NOTIFICATIONS].concurrency,
})
export class NotificationsProcessor extends ReportingWorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly openings: TestOpeningService,
    private readonly deliveryRepair: NotificationDeliveryProcessor,
    @InjectQueue(QUEUE_NAMES.NOTIFICATION_DELIVERY)
    private readonly deliveries: Queue<NotificationDeliveryJobData>,
    failures: QueueFailures,
  ) {
    super(QUEUE_NAMES.NOTIFICATIONS, failures);
  }

  async process(job: Job): Promise<void> {
    if (job.name === NOTIFICATION_JOBS.TESTS_OPENED) {
      await this.openings.sweep();
      return;
    }
    // The sweep, or a write job queued before this deploy: either way the rows are already written.
    try {
      await this.pushPending();
    } finally {
      // After, not before: its paid sends go one at a time and must not hold up a free push.
      if (job.name === NOTIFICATION_JOBS.SWEEP) await this.deliveryRepair.repairStalled();
    }
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

    await this.push.deliverAll(
      rows.flatMap((row) =>
        row.studentId === null
          ? []
          : [
              {
                notificationId: row.id,
                studentId: row.studentId,
                title: row.title,
              },
            ],
      ),
    );
    await this.schedule(rows);
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
            AND ("nextPushAt" IS NULL OR "nextPushAt" <= now())
            ORDER BY "createdAt" LIMIT ${RELAY_BATCH}
            FOR UPDATE SKIP LOCKED)
          RETURNING "id", "studentId", "title", "actBy", "announcementId")
        SELECT c."id", c."studentId", c."title", c."actBy",
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

    if (booked.length === 0) return;

    const now = new Date();
    // One round trip for the page: the next page's free pushes never queue behind 200 of these.
    await this.deliveries.addBulk(
      booked.map((row) => {
        const notification = paid.get(row.notificationId);
        const plan = escalationFor(
          notification?.actBy ?? null,
          now,
          notification?.paidChannels ?? [],
        );
        return {
          name: QUEUE_NAMES.NOTIFICATION_DELIVERY,
          data: { deliveryId: row.id },
          // Keyed on the row, so a swept-again notification schedules the same job rather than a second buy.
          opts: {
            ...keyedJob(notificationDeliveryJobId(row.id)),
            delay: plan.deferSec * MS_PER_SECOND,
          },
        };
      }),
    );
  }
}
