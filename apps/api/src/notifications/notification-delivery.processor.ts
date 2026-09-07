/**
 * The only place the platform spends money on a notification. Wakes after the grace window, and
 * the first thing it does is check whether the free channels already worked — a student who has
 * read the bell is a message nobody needs to buy.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job, type Queue } from 'bullmq';
import { DeliveryStatus, type DeliveryChannel } from '@prisma/client';
import { ActorTypes, NOTIFICATION_TYPE, type NotificationType } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import {
  MESSAGE_KINDS,
  MESSAGE_SENDER,
  type MessageKind,
  type MessageSender,
} from '../common/messaging';
import {
  QUEUE_NAMES,
  QUEUE_POLICY,
  notificationDeliveryJobId,
  type NotificationDeliveryJobData,
} from '../queue/queues';
import { NotificationsService } from './notifications.service';
import {
  OUTBOUND_CHANNEL,
  SKIP_REASONS,
  nextChannelAfter,
  type PaidChannel,
  type SkipReason,
} from './notification-policy';

/** Only the kinds policy lets escalate can arrive here; anything else has no template to send. */
const KIND_OF: Partial<Record<NotificationType, MessageKind>> = {
  [NOTIFICATION_TYPE.RESULT_READY]: MESSAGE_KINDS.RESULT_READY,
  [NOTIFICATION_TYPE.TEST_ASSIGNED]: MESSAGE_KINDS.TEST_ASSIGNED,
  [NOTIFICATION_TYPE.GENERIC]: MESSAGE_KINDS.ANNOUNCEMENT,
};

const ATTEMPT_CAP = QUEUE_POLICY[QUEUE_NAMES.NOTIFICATION_DELIVERY].attempts;

interface NotificationWithChain {
  id: string;
  type: NotificationType;
  announcement: { paidChannels: DeliveryChannel[] } | null;
}

@Injectable()
@Processor(QUEUE_NAMES.NOTIFICATION_DELIVERY, {
  concurrency: QUEUE_POLICY[QUEUE_NAMES.NOTIFICATION_DELIVERY].concurrency,
})
export class NotificationDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationDeliveryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(MESSAGE_SENDER) private readonly sender: MessageSender,
    @InjectQueue(QUEUE_NAMES.NOTIFICATION_DELIVERY)
    private readonly deliveries: Queue<NotificationDeliveryJobData>,
  ) {
    super();
  }

  async process(job: Job<NotificationDeliveryJobData>): Promise<void> {
    await this.deliver(job.data.deliveryId, job.attemptsMade + 1);
  }

  async deliver(deliveryId: string, attempt: number): Promise<void> {
    const row = await this.prisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      include: { notification: { include: { announcement: true } } },
    });
    if (!row || row.status !== DeliveryStatus.PENDING) return;

    // The grace window's whole purpose: the free channels already reached them, so this is free too.
    if (row.notification.isRead) {
      await this.skip(deliveryId, SKIP_REASONS.ALREADY_READ);
      return;
    }

    const channel = row.channel as PaidChannel;
    const kind = KIND_OF[row.notification.type];
    if (!kind) {
      await this.skip(deliveryId, SKIP_REASONS.NO_TEMPLATE);
      return;
    }

    const mobile = await this.notifications.mobileOf(row.notification.studentId ?? '');
    if (!mobile) {
      await this.skip(deliveryId, SKIP_REASONS.NO_CONTACT);
      await this.fallBack(row.notification, channel);
      return;
    }

    try {
      await this.sender.send({
        channel: OUTBOUND_CHANNEL[channel],
        kind,
        to: mobile,
        actor: ActorTypes.STUDENT,
        subject: row.notification.title,
        body: row.notification.body ?? row.notification.title,
        data: variablesOf(row.notification.data),
      });

      await this.prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { status: DeliveryStatus.SENT, sentAt: new Date(), attempts: attempt },
      });
    } catch (error) {
      await this.recordFailure(deliveryId, attempt, error);

      // Under the cap this rethrows, which is what tells BullMQ to back off and try the SAME channel.
      if (attempt < ATTEMPT_CAP) throw error;

      await this.fallBack(row.notification, channel);
    }
  }

  private async skip(deliveryId: string, skipReason: SkipReason): Promise<void> {
    await this.prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status: DeliveryStatus.SKIPPED, skipReason },
    });
  }

  private async recordFailure(deliveryId: string, attempt: number, error: unknown): Promise<void> {
    const lastError = error instanceof Error ? error.message : String(error);
    const spent = attempt >= ATTEMPT_CAP;

    await this.prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        attempts: attempt,
        lastError,
        ...(spent ? { status: DeliveryStatus.FAILED, failedAt: new Date() } : {}),
      },
    });
  }

  /** Books the next channel in the chain. Nothing to book means this message has run out of road. */
  private async fallBack(notification: NotificationWithChain, from: PaidChannel): Promise<void> {
    const next = nextInChain(notification, from);
    if (!next) {
      this.logger.warn(`Notification ${notification.id} could not be delivered on any channel`);
      return;
    }

    const booked = await this.prisma.notificationDelivery.create({
      data: { notificationId: notification.id, channel: next },
    });
    await this.deliveries.add(
      QUEUE_NAMES.NOTIFICATION_DELIVERY,
      { deliveryId: booked.id },
      { jobId: notificationDeliveryJobId(booked.id) },
    );
  }
}

/** An announcement's chain is what the ADMIN chose to spend on it; everything else follows policy. */
function nextInChain(notification: NotificationWithChain, from: PaidChannel): PaidChannel | null {
  const chosen = notification.announcement?.paidChannels as PaidChannel[] | undefined;
  if (!chosen) return nextChannelAfter(notification.type, from);

  const at = chosen.indexOf(from);
  return at >= 0 ? (chosen[at + 1] ?? null) : null;
}

function variablesOf(data: unknown): Record<string, string | number> | undefined {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;

  return data as Record<string, string | number>;
}
