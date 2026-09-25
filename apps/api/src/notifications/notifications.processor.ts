/**
 * Turns a relayed request into the row a student reads, and books whatever the policy allows to
 * be spent reaching them. Re-reads the outbox row rather than trusting the job, so a redelivery
 * cannot send what an older payload said.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job, type Queue } from 'bullmq';
import { DeliveryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  NOTIFICATION_JOBS,
  RELAY_BATCH,
  QUEUE_NAMES,
  QUEUE_POLICY,
  keyedJob,
  notificationDeliveryJobId,
  type NotificationDeliveryJobData,
  type NotificationJobData,
} from '../queue/queues';
import { NotificationsService, type WrittenNotification } from './notifications.service';
import { PAID_CHANNELS, escalationFor } from './notification-policy';
import { PushService } from './push.service';
import { NotificationDeliveryProcessor } from './notification-delivery.processor';
import { TestOpeningService } from './test-opening.service';
import {
  NOTIFICATION_REQUEST,
  NotificationOutbox,
  parseIntent,
  type NotificationIntent,
} from './notification-outbox';
import { QueueFailures } from '../common/metrics/queue-failures';

const MILLISECONDS_PER_SECOND = 1000;

/** How many pushes are in flight at once. Each is an HTTP call, not a database round trip. */
const PUSH_LANES = 8;

/** A bound on one pass, so a backlog is drained by several jobs rather than one that never ends. */
const WRITE_PAGES_PER_PASS = 25;

@Injectable()
@Processor(QUEUE_NAMES.NOTIFICATIONS, {
  concurrency: QUEUE_POLICY[QUEUE_NAMES.NOTIFICATIONS].concurrency,
})
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly outbox: NotificationOutbox,
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

  async process(job: Job<NotificationJobData>): Promise<void> {
    if (job.name === NOTIFICATION_JOBS.SWEEP) {
      await this.outbox.relay();
      await this.deliveryRepair.repairStalled();
      return;
    }
    if (job.name === NOTIFICATION_JOBS.TESTS_OPENED) {
      await this.openings.sweep();
      return;
    }
    // WRITE is a job queued before this deploy: drained as a pass, which claims its row anyway.
    await this.writePending();
  }

  /** One pass drains what it finds: a page at a time, so a backlog does not wait out a sweep each. */
  async writePending(): Promise<number> {
    let written = 0;
    for (let page = 0; page < WRITE_PAGES_PER_PASS; page += 1) {
      const claimed = await this.writePage();
      written += claimed;
      if (claimed < RELAY_BATCH) break;
    }
    return written;
  }

  /** One page: claim it, write it, and mark it only once it is written. */
  private async writePage(): Promise<number> {
    const rows = await this.prisma.outboxEvent.findMany({
      where: { eventType: NOTIFICATION_REQUEST.EVENT_TYPE, processedAt: null },
      orderBy: { createdAt: 'asc' },
      take: RELAY_BATCH,
      select: { id: true, payload: true },
    });
    if (rows.length === 0) return 0;

    const unreadable = rows.filter((row) => parseIntent(row.payload) === null).map((row) => row.id);
    if (unreadable.length > 0) {
      // Marked with the page: a request nothing can act on would block every request behind it.
      this.logger.error(`Notification requests carry no usable intent: ${unreadable.join(', ')}`);
    }

    const intents = rows
      .map((row) => parseIntent(row.payload))
      .filter((intent): intent is NotificationIntent => intent !== null);

    // A paid send is an admin's, rare, and walks a fallback chain — it keeps the one-at-a-time path.
    for (const intent of intents.filter((intent) => (intent.escalate?.length ?? 0) > 0)) {
      await this.writeOne(intent);
    }
    const free = intents.filter((intent) => (intent.escalate?.length ?? 0) === 0);
    await this.pushAll(await this.notifications.createMany(free));

    await this.prisma.outboxEvent.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: { processedAt: new Date() },
    });
    return rows.length;
  }

  /** The chain a paid send walks needs its own booked row, so this one is written on its own. */
  private async writeOne(intent: NotificationIntent): Promise<void> {
    const written = await this.notifications.create(intent);
    // Before the window opens, not inside it: the free channels are what the paid one waits on.
    await this.push.deliver({
      notificationId: written.id,
      studentId: intent.studentId,
      type: intent.type,
      title: intent.title,
    });
    await this.schedule(written.id, intent);
  }

  /** Lanes, because a push is an HTTP call each and a hall's worth of them is not a loop to await. */
  private async pushAll(written: readonly WrittenNotification[]): Promise<void> {
    const pushable = written.filter((row) => row.studentId !== null);

    for (let at = 0; at < pushable.length; at += PUSH_LANES) {
      await Promise.all(
        pushable.slice(at, at + PUSH_LANES).map((row) =>
          this.push.deliver({
            notificationId: row.id,
            studentId: row.studentId ?? '',
            type: row.type,
            title: row.title,
          }),
        ),
      );
    }
  }

  /** The grace window: the free channels get this long before a paid one is bought. */
  private async schedule(notificationId: string, intent: NotificationIntent): Promise<void> {
    // The BOOKED rows are the truth about what may be spent; policy only says how long to wait.
    const booked = await this.prisma.notificationDelivery.findMany({
      // Paid only: a free channel is sent where it is booked, and has no fallback chain to walk.
      where: { notificationId, status: DeliveryStatus.PENDING, channel: { in: PAID_CHANNELS } },
      select: { id: true },
    });
    if (booked.length === 0) return;

    const plan = escalationFor(intent.actBy ?? null, new Date(), intent.escalate);

    for (const row of booked) {
      await this.deliveries.add(
        QUEUE_NAMES.NOTIFICATION_DELIVERY,
        { deliveryId: row.id },
        // Keyed on the row, so a redelivered write schedules the same job rather than a second buy.
        {
          ...keyedJob(notificationDeliveryJobId(row.id)),
          delay: plan.deferSec * MILLISECONDS_PER_SECOND,
        },
      );
    }
  }
}
