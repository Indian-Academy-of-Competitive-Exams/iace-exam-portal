/**
 * What one student has said about how the platform may reach them. An absent row is the channel's
 * own default, so preferences only ever turn a free channel off or opt into a paid one — and the
 * bell has no switch at all, because a student with nothing left on is a student nobody can tell.
 */
import { Injectable } from '@nestjs/common';
import { DeliveryChannel, type NotificationType } from '@prisma/client';
import {
  AppException,
  DELIVERY_CHANNEL,
  ErrorCodes,
  type NotificationPreferences,
  type SetNotificationPreferenceBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { CHANNEL_DEFAULT, LOCKED_CHANNEL } from './notification-policy';

/** The order the student's screen reads them in: the floor first, then free, then what costs. */
const CHANNEL_ORDER = [
  DELIVERY_CHANNEL.IN_APP,
  DELIVERY_CHANNEL.WEB_PUSH,
  DELIVERY_CHANNEL.WHATSAPP,
  DELIVERY_CHANNEL.EMAIL,
  DELIVERY_CHANNEL.SMS,
] as const satisfies readonly DeliveryChannel[];

interface Reachable {
  mobile: boolean;
  email: boolean;
  webPush: boolean;
}

@Injectable()
export class NotificationPreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /** The whole set, every time: a screen that reassembles one row from a patch drifts from the server. */
  async read(studentId: string): Promise<NotificationPreferences> {
    const [rows, reachable] = await Promise.all([
      this.prisma.notificationPreference.findMany({
        where: { studentId, type: null },
        orderBy: { updatedAt: 'asc' },
        select: { channel: true, enabled: true },
      }),
      this.reachableOn(studentId),
    ]);

    const held = new Map(rows.map((row) => [row.channel, row.enabled]));

    return {
      channels: CHANNEL_ORDER.map((channel) => ({
        channel,
        enabled: held.get(channel) ?? CHANNEL_DEFAULT[channel],
        locked: channel === LOCKED_CHANNEL,
        available: availableOn(channel, reachable),
      })),
      webPushPublicKey: this.config.get('VAPID_PUBLIC_KEY') ?? null,
    };
  }

  /** Refused rather than ignored: silently dropping the write would leave the switch lying. */
  async set(
    studentId: string,
    body: SetNotificationPreferenceBody,
  ): Promise<NotificationPreferences> {
    if (body.channel === LOCKED_CHANNEL) {
      throw new AppException(
        ErrorCodes.VALIDATION_ERROR,
        'In-app notifications cannot be turned off.',
      );
    }

    // Replace, not upsert: Postgres holds NULLs distinct, so the index cannot key on a null type.
    await this.prisma.$transaction([
      this.prisma.notificationPreference.deleteMany({
        where: { studentId, channel: body.channel, type: null },
      }),
      this.prisma.notificationPreference.create({
        data: { studentId, channel: body.channel, enabled: body.enabled },
      }),
    ]);

    return this.read(studentId);
  }

  /** The one question delivery asks. A kind's own row wins over the one that covers every kind. */
  async allows(
    studentId: string,
    channel: DeliveryChannel,
    type: NotificationType,
  ): Promise<boolean> {
    if (channel === LOCKED_CHANNEL) return true;

    const rows = await this.prisma.notificationPreference.findMany({
      where: { studentId, channel, OR: [{ type }, { type: null }] },
      orderBy: { updatedAt: 'asc' },
      select: { type: true, enabled: true },
    });

    const forType = rows.findLast((row) => row.type === type);
    const forAll = rows.findLast((row) => row.type === null);

    return (forType ?? forAll)?.enabled ?? CHANNEL_DEFAULT[channel];
  }

  /** A channel with nothing behind it is unavailable, which is a different thing from switched off. */
  private async reachableOn(studentId: string): Promise<Reachable> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { mobile: true, profile: { select: { email: true } } },
    });

    return {
      mobile: Boolean(student?.mobile),
      email: Boolean(student?.profile?.email),
      webPush: this.config.get('VAPID_PUBLIC_KEY') !== undefined,
    };
  }
}

function availableOn(channel: DeliveryChannel, reachable: Reachable): boolean {
  if (channel === DELIVERY_CHANNEL.IN_APP) return true;
  if (channel === DELIVERY_CHANNEL.WEB_PUSH) return reachable.webPush;
  if (channel === DELIVERY_CHANNEL.EMAIL) return reachable.email;
  return reachable.mobile;
}
