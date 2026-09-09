/**
 * The web-push transport, behind a token so a test never talks to a push service. It lives here
 * rather than in common/messaging because that interface is template-and-recipient shaped: push
 * encrypts per SUBSCRIPTION, using keys the browser generated, and has no template to name.
 */
import { Injectable, Logger } from '@nestjs/common';
import { WebPushError, sendNotification, setVapidDetails } from 'web-push';
import { AppConfigService } from '../config/app-config.service';

export const PUSH_SENDER = Symbol('PUSH_SENDER');

/** One browser endpoint and the keys that encrypt for it. */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** A title and a link the app resolves. Never a body: a push must carry no score and no answer. */
export interface PushPayload {
  title: string;
  url: string;
  notificationId: string;
}

/** GONE is the endpoint telling us it is dead, which is the one outcome that deletes a row. */
export const PUSH_OUTCOMES = { SENT: 'SENT', FAILED: 'FAILED', GONE: 'GONE' } as const;

export type PushOutcome = (typeof PUSH_OUTCOMES)[keyof typeof PUSH_OUTCOMES];

export interface PushSender {
  /** False with no VAPID keypair configured, which is a channel to hide rather than a send to fail. */
  readonly isConfigured: boolean;
  send(target: PushTarget, payload: PushPayload): Promise<PushOutcome>;
}

/** A subscription the push service has retired. Anything else is worth keeping and retrying. */
const DEAD_STATUS = new Set([404, 410]);

/** Long enough to reach a phone that is asleep, short enough that a stale result is not delivered. */
const TTL_SEC = 6 * 60 * 60;

@Injectable()
export class WebPushSender implements PushSender {
  private readonly logger = new Logger(WebPushSender.name);

  readonly isConfigured: boolean;

  constructor(config: AppConfigService) {
    const subject = config.get('VAPID_SUBJECT');
    const publicKey = config.get('VAPID_PUBLIC_KEY');
    const privateKey = config.get('VAPID_PRIVATE_KEY');
    this.isConfigured = Boolean(subject && publicKey && privateKey);

    if (this.isConfigured) setVapidDetails(subject ?? '', publicKey ?? '', privateKey ?? '');
    else this.logger.log('Web push is not configured, so the channel reports itself unavailable');
  }

  async send(target: PushTarget, payload: PushPayload): Promise<PushOutcome> {
    if (!this.isConfigured) return PUSH_OUTCOMES.FAILED;

    try {
      await sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        { TTL: TTL_SEC },
      );
      return PUSH_OUTCOMES.SENT;
    } catch (error) {
      const gone = error instanceof WebPushError && DEAD_STATUS.has(error.statusCode);
      if (!gone) this.logger.warn(`Push to ${target.endpoint} failed`, error);

      return gone ? PUSH_OUTCOMES.GONE : PUSH_OUTCOMES.FAILED;
    }
  }
}
