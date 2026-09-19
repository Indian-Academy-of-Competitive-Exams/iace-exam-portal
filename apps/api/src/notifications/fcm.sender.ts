/**
 * The FCM transport, swapped for a fake in tests so none talks to Google. It signs a service
 * account JWT and trades it for an access token rather than pulling in firebase-admin: the whole
 * surface used here is one POST, and the SDK would carry a second HTTP stack into the API.
 */
import { Injectable, Logger } from '@nestjs/common';
import { createSign } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';
import { PUSH_OUTCOMES, type PushOutcome, type PushPayload } from './web-push.sender';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const JWT_TTL_SEC = 3600;

/** Renewed early, so a token cannot expire between the check and the send it was fetched for. */
const RENEW_MARGIN_MS = 60_000;

/** Long enough to reach a phone that is asleep, short enough that a stale result is not delivered. */
const TTL_SEC = 6 * 60 * 60;

/** FCM saying the token is not registered any more, which is the one answer that deletes a row. */
const DEAD_CODES = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH']);

interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

@Injectable()
export class FcmSender {
  private readonly logger = new Logger(FcmSender.name);

  /** False with no service account configured, which is a channel to hide rather than a send to fail. */
  readonly isConfigured: boolean;

  private readonly account: ServiceAccount | null;
  private access: { token: string; expiresAt: number } | null = null;

  constructor(config: AppConfigService) {
    const projectId = config.get('FCM_PROJECT_ID');
    const clientEmail = config.get('FCM_CLIENT_EMAIL');
    // Stored as one line, because an .env value cannot carry the real newlines a PEM has.
    const privateKey = config.get('FCM_PRIVATE_KEY')?.replaceAll(String.raw`\n`, '\n');

    this.isConfigured = Boolean(projectId && clientEmail && privateKey);
    this.account = this.isConfigured
      ? { projectId: projectId ?? '', clientEmail: clientEmail ?? '', privateKey: privateKey ?? '' }
      : null;

    if (!this.isConfigured) {
      this.logger.log('Mobile push is not configured, so the channel reports itself unavailable');
    }
  }

  async send(token: string, payload: PushPayload): Promise<PushOutcome> {
    if (!this.account) return PUSH_OUTCOMES.FAILED;

    try {
      const access = await this.accessToken(this.account);
      const response = await fetch(sendUrl(this.account.projectId), {
        method: 'POST',
        headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
        body: JSON.stringify(messageFor(token, payload)),
      });
      if (response.ok) return PUSH_OUTCOMES.SENT;

      const outcome = outcomeOf(response.status, await response.text());
      if (outcome === PUSH_OUTCOMES.FAILED) {
        this.logger.warn(`FCM refused a push with ${response.status}`);
      }
      return outcome;
    } catch (error) {
      this.logger.warn('FCM could not be reached', error);
      return PUSH_OUTCOMES.FAILED;
    }
  }

  /** Cached until it is nearly out: one token serves every push in the hour it was minted for. */
  private async accessToken(account: ServiceAccount): Promise<string> {
    if (this.access && this.access.expiresAt - RENEW_MARGIN_MS > Date.now()) {
      return this.access.token;
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signedAssertion(account),
      }).toString(),
    });
    if (!response.ok) throw new Error(`Google refused the service account (${response.status})`);

    const granted = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!granted.access_token) throw new Error('Google returned no access token');

    this.access = {
      token: granted.access_token,
      expiresAt: Date.now() + (granted.expires_in ?? JWT_TTL_SEC) * 1000,
    };
    return this.access.token;
  }
}

const sendUrl = (projectId: string) =>
  `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

/** The browser's payload rule kept: a title and a way in, never a body — a lock screen renders it. */
export function messageFor(token: string, payload: PushPayload): object {
  return {
    message: {
      token,
      notification: { title: payload.title },
      data: { url: payload.url, notificationId: payload.notificationId },
      android: { ttl: `${TTL_SEC}s`, priority: 'HIGH' },
      apns: { headers: { 'apns-expiration': String(Math.floor(Date.now() / 1000) + TTL_SEC) } },
    },
  };
}

/** A token FCM has retired is GONE; anything else is worth keeping and retrying. */
export function outcomeOf(status: number, body: string): PushOutcome {
  if (status === 404) return PUSH_OUTCOMES.GONE;
  if (status !== 400 && status !== 403) return PUSH_OUTCOMES.FAILED;

  const code = errorCodeOf(body);
  return code !== null && DEAD_CODES.has(code) ? PUSH_OUTCOMES.GONE : PUSH_OUTCOMES.FAILED;
}

/** FCM names the reason in `error.details[].errorCode`, and repeats a coarser one in `error.status`. */
function errorCodeOf(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: { status?: string; details?: { errorCode?: string }[] };
    };
    const detail = parsed.error?.details?.find((one) => typeof one.errorCode === 'string');
    return detail?.errorCode ?? parsed.error?.status ?? null;
  } catch {
    return null;
  }
}

/** RS256 over the claims Google asks for, signed with the service account's own key. */
function signedAssertion(account: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: account.clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + JWT_TTL_SEC,
  };

  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);

  return `${unsigned}.${signer.sign(account.privateKey, 'base64url')}`;
}

const base64Url = (value: string) => Buffer.from(value).toString('base64url');
