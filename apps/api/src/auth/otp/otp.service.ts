import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
  type ActorType,
  type OtpRequestResponse,
} from '@iace/contracts';
import { AppConfigService } from '../../config/app-config.service';
import { OTP_SENDERS } from '../../config/env.schema';
import { RedisService } from '../../redis/redis.service';
import { redisKeys } from '../../redis/redis.keys';
import {
  MESSAGE_CHANNELS,
  MESSAGE_KINDS,
  MESSAGE_SENDER,
  type MessageChannel,
  type MessageSender,
} from '../../common/messaging';
import { type StoredOtp } from '../auth.types';

/**
 * OTP lifecycle. Every piece of state — the code hash, the attempt counter and
 * the resend cooldown — lives in Redis under a TTL and NEVER touches Postgres,
 * so expiry is the datastore's job and there is nothing to clean up.
 *
 * The plaintext code exists only in memory long enough to be delivered; Redis
 * holds an HMAC of it.
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    @Inject(MESSAGE_SENDER) private readonly sender: MessageSender,
  ) {}

  /** Policy values, exposed so callers can echo them without re-reading config. */
  get ttlSec(): number {
    return this.config.get('OTP_TTL_SEC');
  }

  get cooldownSec(): number {
    return this.config.get('OTP_RESEND_COOLDOWN_SEC');
  }

  get codeLength(): number {
    return this.config.get('OTP_LENGTH');
  }

  async request(actor: ActorType, identifier: string): Promise<OtpRequestResponse> {
    const cooldownKey = redisKeys.otpCooldown(actor, identifier);
    const remaining = await this.redis.ttl(cooldownKey);
    if (remaining > 0) {
      throw new AppException(
        ErrorCodes.RATE_LIMITED,
        `Please wait ${remaining}s before requesting another code`,
        { details: { retryAfterSec: remaining } },
      );
    }

    const ttlSec = this.config.get('OTP_TTL_SEC');
    const cooldownSec = this.config.get('OTP_RESEND_COOLDOWN_SEC');
    const code = this.generateCode();

    const stored: StoredOtp = {
      codeHash: this.hash(code),
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    await this.redis.setJson(redisKeys.otp(actor, identifier), stored, ttlSec);
    if (cooldownSec > 0) {
      await this.redis.client.set(cooldownKey, '1', 'EX', cooldownSec);
    }

    await this.sender.send({
      channel: channelFor(actor),
      kind: MESSAGE_KINDS.OTP,
      to: identifier,
      actor,
      subject: 'Your IACE verification code',
      body: `${code} is your IACE verification code. It expires in ${ttlSec} seconds.`,
      // The provider fills its DLT-registered template from these; `body` is
      // what a console or SMTP sender shows when there is no template.
      data: { code, ttlSec },
    });

    return {
      sent: true,
      expiresInSec: ttlSec,
      resendAfterSec: cooldownSec,
      codeLength: code.length,
      // Convenience for local development only — never with a real sender,
      // and never outside development.
      ...(this.config.get('OTP_SENDER') === OTP_SENDERS.CONSOLE && this.config.isDevelopment
        ? { devCode: code }
        : {}),
    };
  }

  /**
   * Consumes the pending code. Throws on wrong/expired codes and burns the
   * challenge once the attempt cap is hit, so a code cannot be brute-forced
   * inside its TTL.
   */
  async verify(actor: ActorType, identifier: string, code: string): Promise<void> {
    const key = redisKeys.otp(actor, identifier);
    const stored = await this.redis.getJson<StoredOtp>(key);
    if (!stored)
      throw new AppException(ErrorCodes.OTP_EXPIRED, 'Code has expired — request a new one');

    if (!this.matches(code, stored.codeHash)) {
      const attempts = stored.attempts + 1;
      if (attempts >= this.config.get('OTP_MAX_VERIFY_ATTEMPTS')) {
        await this.redis.del(key);
        // The challenge is burnt, not just wrong — a different code, because
        // the client's next step is "request a new one", not "try again".
        throw new AppException(
          ErrorCodes.RATE_LIMITED,
          'Too many incorrect attempts — request a new code',
        );
      }
      const ttl = await this.redis.ttl(key);
      await this.redis.setJson(key, { ...stored, attempts }, ttl > 0 ? ttl : 1);
      throw new AppException(ErrorCodes.OTP_INVALID, 'Incorrect code', {
        fieldErrors: { code: ['Incorrect code'] },
        details: { attemptsRemaining: this.config.get('OTP_MAX_VERIFY_ATTEMPTS') - attempts },
      });
    }

    // Single use: a verified code is gone, and the next resend is immediate.
    await this.redis.del(key, redisKeys.otpCooldown(actor, identifier));
  }

  /** Uniform over the full range — `randomInt` is CSPRNG-backed, unlike Math.random. */
  private generateCode(): string {
    const length = this.config.get('OTP_LENGTH');
    const max = 10 ** length;
    return String(randomInt(0, max)).padStart(length, '0');
  }

  private hash(code: string): string {
    return createHmac('sha256', this.config.get('JWT_ACCESS_SECRET')).update(code).digest('hex');
  }

  private matches(code: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hash(code), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}

/**
 * Students are reached on the mobile number they signed up with, admins on
 * their email address — the same split the two identity tables have. It lives
 * beside the only caller rather than in the messaging module, because it is a
 * fact about how THIS platform's actors are contacted, not about delivery.
 */
function channelFor(actor: ActorType): MessageChannel {
  return actor === ActorTypes.STUDENT ? MESSAGE_CHANNELS.SMS : MESSAGE_CHANNELS.EMAIL;
}
