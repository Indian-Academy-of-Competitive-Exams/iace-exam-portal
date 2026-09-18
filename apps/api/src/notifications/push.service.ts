/**
 * Owns `PushSubscription` and `PushDevice`, and the free fan-out to both: a browser through
 * web-push, a phone through FCM. Best-effort by contract — the bell row is already committed by
 * the time this runs, so nothing here may throw its way back into the job that wrote it.
 */
import { Injectable, Logger } from '@nestjs/common';
import { DeliveryChannel, DeliveryStatus, type NotificationType } from '@prisma/client';
import {
  NOTIFICATION_INBOX_PATH,
  type PushDeviceBody,
  type PushSubscriptionBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { FcmSender } from './fcm.sender';
import { PUSH_OUTCOMES, WebPushSender, type PushPayload } from './web-push.sender';

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
    private readonly config: AppConfigService,
    private readonly sender: WebPushSender,
    private readonly fcm: FcmSender,
  ) {}

  /** Null is a channel nothing can carry, which the screen shows differently from one switched off. */
  publicKey(): string | null {
    return this.config.get('VAPID_PUBLIC_KEY') ?? null;
  }

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

  /** Keyed on the token FCM issued: the same phone re-registering is the same row, moved if it must be. */
  async registerDevice(studentId: string, body: PushDeviceBody): Promise<void> {
    const device = { platform: body.platform, deviceName: body.deviceName ?? null };

    await this.prisma.pushDevice.upsert({
      where: { token: body.token },
      create: { studentId, token: body.token, ...device },
      update: { studentId, lastSeenAt: new Date(), ...device },
    });
  }

  /** Scoped by student, so somebody else's token in the body deletes nothing. */
  async dropDevice(studentId: string, token: string): Promise<void> {
    await this.prisma.pushDevice.deleteMany({ where: { studentId, token } });
  }

  /** Never throws: the caller has already written the bell, which is the source of truth. */
  async deliver(input: PushDelivery): Promise<void> {
    const payload = {
      title: input.title,
      url: NOTIFICATION_INBOX_PATH,
      notificationId: input.notificationId,
    };

    // Two channels, each booked on its own ledger row: a phone reached is not a browser reached.
    await Promise.all([
      this.attempt(input, DeliveryChannel.WEB_PUSH, () => this.sendWeb(input, payload)),
      this.attempt(input, DeliveryChannel.MOBILE_PUSH, () => this.sendMobile(input, payload)),
    ]);
  }

  private async attempt(
    input: PushDelivery,
    channel: DeliveryChannel,
    send: () => Promise<void>,
  ): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.warn(`${channel} for notification ${input.notificationId} failed`, error);
    }
  }

  private async sendWeb(input: PushDelivery, payload: PushPayload): Promise<void> {
    if (!this.sender.isConfigured) return;

    // A ledger row means this was already decided, so a redelivered job cannot push a second time.
    if (await this.settled(input.notificationId, DeliveryChannel.WEB_PUSH)) return;

    const targets = await this.prisma.pushSubscription.findMany({
      where: { studentId: input.studentId },
      select: { endpoint: true, p256dh: true, auth: true },
    });
    // A browser subscription IS the consent, so no subscription is an absence and not a refusal.
    if (targets.length === 0) return;

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

    await this.record(
      input.notificationId,
      DeliveryChannel.WEB_PUSH,
      outcomes.some((row) => row.outcome === PUSH_OUTCOMES.SENT),
      outcomes.length,
    );
  }

  /** The phones this student has signed in on, each reached by the token FCM issued it. */
  private async sendMobile(input: PushDelivery, payload: PushPayload): Promise<void> {
    if (!this.fcm.isConfigured) return;
    if (await this.settled(input.notificationId, DeliveryChannel.MOBILE_PUSH)) return;

    const devices = await this.prisma.pushDevice.findMany({
      where: { studentId: input.studentId },
      select: { token: true },
    });
    // Registering the token IS the consent, so no device is an absence and not a refusal.
    if (devices.length === 0) return;

    const outcomes = await Promise.all(
      devices.map(async (device) => ({
        token: device.token,
        outcome: await this.fcm.send(device.token, payload),
      })),
    );

    const dead = outcomes.filter((row) => row.outcome === PUSH_OUTCOMES.GONE);
    if (dead.length > 0) {
      await this.prisma.pushDevice.deleteMany({
        where: { token: { in: dead.map((row) => row.token) } },
      });
    }

    await this.record(
      input.notificationId,
      DeliveryChannel.MOBILE_PUSH,
      outcomes.some((row) => row.outcome === PUSH_OUTCOMES.SENT),
      outcomes.length,
    );
  }

  /** A ledger row means this was already decided, so a redelivered job cannot push a second time. */
  private async settled(notificationId: string, channel: DeliveryChannel): Promise<boolean> {
    const row = await this.prisma.notificationDelivery.findUnique({
      where: { notificationId_channel: { notificationId, channel } },
      select: { id: true },
    });
    return row !== null;
  }

  /** Upsert, not create: the ledger holds one row per notification and channel, whatever retries. */
  private async record(
    notificationId: string,
    channel: DeliveryChannel,
    reached: boolean,
    tried: number,
  ): Promise<void> {
    const outcome: DeliveryOutcome = reached
      ? { status: DeliveryStatus.SENT, sentAt: new Date(), attempts: 1 }
      : {
          status: DeliveryStatus.FAILED,
          failedAt: new Date(),
          attempts: 1,
          lastError: `Nothing accepted the push (${tried} tried)`,
        };

    await this.prisma.notificationDelivery.upsert({
      where: { notificationId_channel: { notificationId, channel } },
      create: { notificationId, channel, ...outcome },
      update: outcome,
    });
  }
}

interface DeliveryOutcome {
  status: DeliveryStatus;
  sentAt?: Date;
  failedAt?: Date;
  attempts?: number;
  lastError?: string;
}
