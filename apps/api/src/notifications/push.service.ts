/**
 * Owns `PushSubscription` and the free web-push fan-out. Best-effort by contract: the bell row is
 * already committed by the time this runs, so nothing here may throw its way back into the job that
 * wrote it — a push service being down is not a student left untold.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DeliveryChannel, DeliveryStatus, type NotificationType } from '@prisma/client';
import { NOTIFICATION_INBOX_PATH, type PushSubscriptionBody } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { SKIP_REASONS, type SkipReason } from './notification-policy';
import { PUSH_OUTCOMES, PUSH_SENDER, type PushSender } from './web-push.sender';

/** What one push is sent from. The title only — the body may name marks, and a push must not. */
export interface PushDelivery {
  notificationId: string;
  studentId: string;
  type: NotificationType;
  title: string;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: NotificationPreferencesService,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  /** Keyed on the endpoint the browser gave: the same device resubscribing is the same row. */
  async subscribe(studentId: string, body: PushSubscriptionBody): Promise<void> {
    const keys = { p256dh: body.p256dh, auth: body.auth, userAgent: body.userAgent ?? null };

    await this.prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: { studentId, endpoint: body.endpoint, ...keys },
      update: { studentId, lastSeenAt: new Date(), ...keys },
    });
  }

  /** Scoped by student, so somebody else's endpoint in the body deletes nothing. */
  async unsubscribe(studentId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { studentId, endpoint } });
  }

  /** Never throws: the caller has already written the bell, which is the source of truth. */
  async deliver(input: PushDelivery): Promise<void> {
    try {
      await this.send(input);
    } catch (error) {
      this.logger.warn(`Web push for notification ${input.notificationId} failed`, error);
    }
  }

  private async send(input: PushDelivery): Promise<void> {
    if (!this.sender.isConfigured) return;

    // A ledger row means this was already decided, so a redelivered job cannot push a second time.
    const settled = await this.prisma.notificationDelivery.findUnique({
      where: {
        notificationId_channel: {
          notificationId: input.notificationId,
          channel: DeliveryChannel.WEB_PUSH,
        },
      },
      select: { id: true },
    });
    if (settled) return;

    const allowed = await this.preferences.allows(
      input.studentId,
      DeliveryChannel.WEB_PUSH,
      input.type,
    );
    if (!allowed) {
      await this.record(input.notificationId, {
        status: DeliveryStatus.SKIPPED,
        skipReason: SKIP_REASONS.OPTED_OUT,
      });
      return;
    }

    const targets = await this.prisma.pushSubscription.findMany({
      where: { studentId: input.studentId },
      select: { endpoint: true, p256dh: true, auth: true },
    });
    // A student who has enabled push in no browser is an absence, not a decision worth 50,000 rows.
    if (targets.length === 0) return;

    const payload = {
      title: input.title,
      url: NOTIFICATION_INBOX_PATH,
      notificationId: input.notificationId,
    };
    const outcomes = await Promise.all(
      targets.map(async (target) => ({
        endpoint: target.endpoint,
        outcome: await this.sender.send(target, payload),
      })),
    );

    const dead = outcomes.filter((row) => row.outcome === PUSH_OUTCOMES.GONE);
    if (dead.length > 0) {
      await this.prisma.pushSubscription.deleteMany({
        where: { endpoint: { in: dead.map((row) => row.endpoint) } },
      });
    }

    const reached = outcomes.some((row) => row.outcome === PUSH_OUTCOMES.SENT);
    await this.record(
      input.notificationId,
      reached
        ? { status: DeliveryStatus.SENT, sentAt: new Date(), attempts: 1 }
        : {
            status: DeliveryStatus.FAILED,
            failedAt: new Date(),
            attempts: 1,
            lastError: `No subscription accepted the push (${outcomes.length} tried)`,
          },
    );
  }

  /** Upsert, not create: the ledger holds one row per notification and channel, whatever retries. */
  private async record(notificationId: string, outcome: DeliveryOutcome): Promise<void> {
    const channel = DeliveryChannel.WEB_PUSH;

    await this.prisma.notificationDelivery.upsert({
      where: { notificationId_channel: { notificationId, channel } },
      create: { notificationId, channel, ...outcome },
      update: outcome,
    });
  }
}

interface DeliveryOutcome {
  status: DeliveryStatus;
  skipReason?: SkipReason;
  sentAt?: Date;
  failedAt?: Date;
  attempts?: number;
  lastError?: string;
}
