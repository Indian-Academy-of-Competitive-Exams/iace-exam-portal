/**
 * Owns `PushSubscription` and `PushDevice`, and the free fan-out to both: a browser through
 * web-push, a phone through FCM. Best-effort by contract — the bell row is already committed by
 * the time this runs, so nothing here may throw its way back into the job that wrote it.
 */
import { Injectable, Logger } from '@nestjs/common';
import { DeliveryChannel, DeliveryStatus, Prisma } from '@prisma/client';
import {
  ActorTypes,
  isAllowedPushEndpoint,
  NOTIFICATION_INBOX_PATH,
  type PushDeviceBody,
  type PushSubscriptionBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { redisKeys } from '../redis/redis.keys';
import { AppConfigService } from '../config/app-config.service';
import { FcmSender } from './fcm.sender';
import { PUSH_OUTCOMES, WebPushSender, type PushOutcome } from './web-push.sender';

/** What one push is sent from. The title only — the body may name marks, and a push must not. */
export interface PushDelivery {
  notificationId: string;
  studentId: string;
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
    private readonly redis: RedisService,
  ) {}

  /** Null is a channel nothing can carry, which the screen shows differently from one switched off. */
  publicKey(): string | null {
    return this.config.get('VAPID_PUBLIC_KEY') ?? null;
  }

  /** Keyed on the endpoint the browser gave: the same device resubscribing is the same row. */
  async subscribe(studentId: string, sessionId: string, body: PushSubscriptionBody): Promise<void> {
    const keys = {
      p256dh: body.p256dh,
      auth: body.auth,
      userAgent: body.userAgent ?? null,
      sessionId,
    };

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
  async registerDevice(studentId: string, sessionId: string, body: PushDeviceBody): Promise<void> {
    const device = { platform: body.platform, deviceName: body.deviceName ?? null, sessionId };

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

  /** Never throws: the caller has already written the bell, which is the source of truth. A page at a time — one read of its ledger, browsers and phones, then each pushed in lanes. */
  async deliverAll(inputs: readonly PushDelivery[]): Promise<void> {
    if (inputs.length === 0) return;
    try {
      const reach = await this.reachOf(inputs);
      const outcome: PageOutcome = { ledger: [], deadEndpoints: [], deadTokens: [] };
      for (let at = 0; at < inputs.length; at += PUSH_LANES) {
        await Promise.all(
          inputs.slice(at, at + PUSH_LANES).map((input) => this.push(input, reach, outcome)),
        );
      }
      await this.settle(outcome);
    } catch (error) {
      this.logger.warn(`Pushing ${inputs.length} notifications failed`, error);
    }
  }

  private async reachOf(inputs: readonly PushDelivery[]): Promise<Reach> {
    const notificationId = { in: inputs.map((input) => input.notificationId) };
    const studentId = { in: [...new Set(inputs.map((input) => input.studentId))] };
    const [priors, subscriptions, devices] = await Promise.all([
      // A ledger row is what a redelivered job reads to see it must not push the same thing twice.
      this.prisma.notificationDelivery.findMany({
        where: { notificationId, channel: { in: PUSH_CHANNELS } },
        select: { notificationId: true, channel: true, status: true, attempts: true },
      }),
      this.sender.isConfigured
        ? this.prisma.pushSubscription.findMany({
            where: { studentId },
            select: { studentId: true, endpoint: true, p256dh: true, auth: true, sessionId: true },
          })
        : [],
      this.fcm.isConfigured
        ? this.prisma.pushDevice.findMany({
            where: { studentId },
            select: { studentId: true, token: true, sessionId: true },
          })
        : [],
    ]);

    const signedOut = await this.signedOut([...subscriptions, ...devices]);
    const live = (target: SessionBound) => !signedOut.has(sessionKey(target));
    // Stored before this host rule existed, or never valid: dropped like a dead one, never POSTed to.
    const refused = subscriptions.filter(
      (target) => !isAllowedPushEndpoint(target.endpoint) || !live(target),
    );
    const orphaned = devices.filter((device) => !live(device));
    // Matched on the owner as read: a target another sign-in rebound meanwhile is theirs now, and stays.
    if (refused.length > 0) {
      await this.prisma.pushSubscription.deleteMany({
        where: {
          OR: refused.map(({ endpoint, studentId, sessionId }) => ({
            endpoint,
            studentId,
            sessionId,
          })),
        },
      });
    }
    if (orphaned.length > 0) {
      await this.prisma.pushDevice.deleteMany({
        where: {
          OR: orphaned.map(({ token, studentId, sessionId }) => ({ token, studentId, sessionId })),
        },
      });
    }

    return {
      priors: new Map(
        priors.map((row) => [ledgerKey(row.notificationId, row.channel), row] as const),
      ),
      browsers: Map.groupBy(
        subscriptions.filter((target) => isAllowedPushEndpoint(target.endpoint) && live(target)),
        (target) => target.studentId,
      ),
      phones: Map.groupBy(
        devices.filter((device) => live(device)),
        (device) => device.studentId,
      ),
    };
  }

  /** The sessions a page's targets were registered from that have since ended, in one read. */
  private async signedOut(targets: readonly SessionBound[]): Promise<Set<string>> {
    const bound = [
      ...new Map(
        targets.flatMap((target) =>
          target.sessionId === null ? [] : [[sessionKey(target), target] as const],
        ),
      ).values(),
    ];
    if (bound.length === 0) return new Set();
    const found = await this.redis.mgetJson<unknown>(
      bound.map((target) =>
        redisKeys.session(ActorTypes.STUDENT, target.studentId, target.sessionId ?? ''),
      ),
    );
    return new Set(
      bound.flatMap((target, index) => (found[index] === null ? [sessionKey(target)] : [])),
    );
  }

  /** Two channels, each booked on its own ledger row: a phone reached is not a browser reached. */
  private async push(input: PushDelivery, reach: Reach, outcome: PageOutcome): Promise<void> {
    const payload = {
      title: input.title,
      url: NOTIFICATION_INBOX_PATH,
      notificationId: input.notificationId,
    };
    // A send that got through is settled; one that nothing accepted is open again until the cap.
    const open = (channel: DeliveryChannel) => {
      const prior = reach.priors.get(ledgerKey(input.notificationId, channel));
      return (
        prior === undefined ||
        (prior.status === DeliveryStatus.FAILED && prior.attempts < PUSH_ATTEMPT_CAP)
      );
    };

    // A subscription or a token IS the consent, so having none is an absence and not a refusal.
    const browsers = reach.browsers.get(input.studentId) ?? [];
    const phones = reach.phones.get(input.studentId) ?? [];

    await Promise.all([
      open(DeliveryChannel.WEB_PUSH) && browsers.length > 0
        ? this.attempt(input, DeliveryChannel.WEB_PUSH, reach, outcome, () =>
            Promise.all(
              browsers.map(async (target) => {
                const result = await this.sender.send(target, payload);
                if (result === PUSH_OUTCOMES.GONE) outcome.deadEndpoints.push(target.endpoint);
                return result;
              }),
            ),
          )
        : null,
      open(DeliveryChannel.MOBILE_PUSH) && phones.length > 0
        ? this.attempt(input, DeliveryChannel.MOBILE_PUSH, reach, outcome, () =>
            Promise.all(
              phones.map(async (device) => {
                const result = await this.fcm.send(device.token, payload);
                if (result === PUSH_OUTCOMES.GONE) outcome.deadTokens.push(device.token);
                return result;
              }),
            ),
          )
        : null,
    ]);
  }

  private async attempt(
    input: PushDelivery,
    channel: DeliveryChannel,
    reach: Reach,
    outcome: PageOutcome,
    send: () => Promise<PushOutcome[]>,
  ): Promise<void> {
    const prior = reach.priors.get(ledgerKey(input.notificationId, channel));
    try {
      const results = await send();
      outcome.ledger.push(
        ledgerRow(input.notificationId, channel, results, (prior?.attempts ?? 0) + 1),
      );
    } catch (error) {
      this.logger.warn(`${channel} for notification ${input.notificationId} failed`, error);
    }
  }

  /** The page's new rows in one write, its retries one each, and whatever is gone pruned in one. */
  private async settle(outcome: PageOutcome): Promise<void> {
    await Promise.all([
      outcome.deadEndpoints.length > 0
        ? this.prisma.pushSubscription.deleteMany({
            where: { endpoint: { in: outcome.deadEndpoints } },
          })
        : null,
      outcome.deadTokens.length > 0
        ? this.prisma.pushDevice.deleteMany({ where: { token: { in: outcome.deadTokens } } })
        : null,
    ]);
    // A second attempt has a row to move, so it cannot be a duplicate to skip past.
    const retried = outcome.ledger.filter((row) => row.attempts > 1);
    await this.prisma.notificationDelivery.createMany({
      // Skipping a duplicate: a racing pass that booked the same row first already decided it.
      data: outcome.ledger.filter((row) => row.attempts === 1),
      skipDuplicates: true,
    });
    for (const row of retried) {
      await this.prisma.notificationDelivery.updateMany({
        where: { notificationId: row.notificationId, channel: row.channel },
        data: {
          status: row.status,
          attempts: row.attempts,
          sentAt: row.sentAt ?? null,
          failedAt: row.failedAt ?? null,
          lastError: row.lastError ?? null,
        },
      });
    }
    await this.reopen(outcome.ledger);
  }

  /** Unstamps the sweep's claim, so a push nothing accepted is tried again rather than lost. */
  private async reopen(ledger: readonly LedgerRow[]): Promise<void> {
    const reached = new Set(
      ledger.flatMap((row) => (row.status === DeliveryStatus.SENT ? [row.notificationId] : [])),
    );
    const lost = ledger.flatMap((row) =>
      row.status === DeliveryStatus.FAILED &&
      !reached.has(row.notificationId) &&
      row.attempts < PUSH_ATTEMPT_CAP
        ? [row.notificationId]
        : [],
    );
    if (lost.length === 0) return;

    await this.prisma.notification.updateMany({
      where: { id: { in: lost } },
      data: { pushedAt: null },
    });
  }
}

/** The free channels this service books; the paid ones belong to the delivery processor. */
const PUSH_CHANNELS: DeliveryChannel[] = [DeliveryChannel.WEB_PUSH, DeliveryChannel.MOBILE_PUSH];

/** Lanes, because a push is an HTTP call each and a hall's worth of them is not a loop to await. */
const PUSH_LANES = 8;

/** ponytail: three sweeps of riding out a web-push or FCM outage; a backlogged pass may spend them in one go. */
const PUSH_ATTEMPT_CAP = 3;

type WebTarget = { endpoint: string; p256dh: string; auth: string };

/** A push target and the sign-in it came from; null is a row from before the session was kept. */
interface SessionBound {
  studentId: string;
  sessionId: string | null;
}

const sessionKey = (target: SessionBound): string =>
  `${target.studentId}:${target.sessionId ?? ''}`;

interface Reach {
  priors: ReadonlyMap<string, { status: DeliveryStatus; attempts: number }>;
  browsers: ReadonlyMap<string, WebTarget[]>;
  phones: ReadonlyMap<string, { token: string }[]>;
}

interface PageOutcome {
  ledger: LedgerRow[];
  deadEndpoints: string[];
  deadTokens: string[];
}

const ledgerKey = (notificationId: string, channel: DeliveryChannel) =>
  `${notificationId}:${channel}`;

/** What one channel's attempt decided. `attempts` is required: it is the bound on retrying a free push. */
type LedgerRow = Prisma.NotificationDeliveryCreateManyInput & {
  status: DeliveryStatus;
  attempts: number;
};

function ledgerRow(
  notificationId: string,
  channel: DeliveryChannel,
  results: readonly PushOutcome[],
  attempts: number,
): LedgerRow {
  const now = new Date();
  if (results.includes(PUSH_OUTCOMES.SENT)) {
    return { notificationId, channel, status: DeliveryStatus.SENT, sentAt: now, attempts };
  }
  return {
    notificationId,
    channel,
    status: DeliveryStatus.FAILED,
    failedAt: now,
    attempts,
    lastError: `Nothing accepted the push (${results.length} tried)`,
  };
}
