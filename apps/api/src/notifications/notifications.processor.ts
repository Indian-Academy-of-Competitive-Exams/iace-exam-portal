/**
 * Turns a relayed request into the row a student reads, and books whatever the policy allows to
 * be spent reaching them. Re-reads the outbox row rather than trusting the job, so a redelivery
 * cannot send what an older payload said.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job, type Queue } from 'bullmq';
import { DeliveryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  NOTIFICATION_JOBS,
  QUEUE_NAMES,
  QUEUE_POLICY,
  notificationDeliveryJobId,
  type NotificationDeliveryJobData,
  type NotificationJobData,
} from '../queue/queues';
import { NotificationsService } from './notifications.service';
import { PAID_CHANNELS, escalationFor } from './notification-policy';
import { PushService } from './push.service';
import { TestOpeningService } from './test-opening.service';
import { NotificationOutbox, parseIntent, type NotificationIntent } from './notification-outbox';

const MILLISECONDS_PER_SECOND = 1000;

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
    @InjectQueue(QUEUE_NAMES.NOTIFICATION_DELIVERY)
    private readonly deliveries: Queue<NotificationDeliveryJobData>,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    if (job.name === NOTIFICATION_JOBS.SWEEP) {
      await this.outbox.relay();
      return;
    }
    if (job.name === NOTIFICATION_JOBS.TESTS_OPENED) {
      await this.openings.sweep();
      return;
    }
    if (job.data.eventId) await this.write(job.data.eventId);
  }

  /** Idempotent through the dedupe key, so a retried job re-reads its own row instead of adding one. */
  async write(eventId: string): Promise<void> {
    const event = await this.prisma.outboxEvent.findUnique({
      where: { id: eventId },
      select: { payload: true },
    });
    if (!event) {
      // A pruned request is one already acted on: retrying it would tell somebody twice.
      this.logger.warn(`Notification request ${eventId} is gone, so nothing is written`);
      return;
    }

    const intent = parseIntent(event.payload);
    if (!intent) {
      this.logger.error(`Notification request ${eventId} carries no usable intent`);
      return;
    }

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

  /** The grace window: the free channels get this long before a paid one is bought. */
  private async schedule(notificationId: string, intent: NotificationIntent): Promise<void> {
    // The BOOKED rows are the truth about what may be spent; policy only says how long to wait.
    const booked = await this.prisma.notificationDelivery.findMany({
      // Paid only: a free channel is sent where it is booked, and has no fallback chain to walk.
      where: { notificationId, status: DeliveryStatus.PENDING, channel: { in: PAID_CHANNELS } },
      select: { id: true },
    });
    if (booked.length === 0) return;

    const plan = escalationFor(intent.type, intent.actBy ?? null, new Date(), intent.escalate);

    for (const row of booked) {
      await this.deliveries.add(
        QUEUE_NAMES.NOTIFICATION_DELIVERY,
        { deliveryId: row.id },
        {
          // Keyed on the row, so a redelivered write schedules the same job rather than a second buy.
          jobId: notificationDeliveryJobId(row.id),
          delay: plan.deferSec * MILLISECONDS_PER_SECOND,
        },
      );
    }
  }
}
