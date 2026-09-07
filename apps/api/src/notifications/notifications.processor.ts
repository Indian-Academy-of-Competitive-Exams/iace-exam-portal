/**
 * Turns a relayed request into the row a student reads, and books whatever the policy allows to
 * be spent reaching them. Re-reads the outbox row rather than trusting the job, so a redelivery
 * cannot send what an older payload said.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES, QUEUE_POLICY, type NotificationJobData } from '../queue/queues';
import { NotificationsService } from './notifications.service';
import { parseIntent } from './notification-outbox';

@Injectable()
@Processor(QUEUE_NAMES.NOTIFICATIONS, {
  concurrency: QUEUE_POLICY[QUEUE_NAMES.NOTIFICATIONS].concurrency,
})
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    await this.write(job.data.eventId);
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

    await this.notifications.create(intent);
  }
}
