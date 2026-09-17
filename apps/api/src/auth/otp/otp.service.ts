import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomInt } from 'node:crypto';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
  type ActorType,
  type OtpRequestResponse,
} from '@iace/contracts';
import { sameHex } from '../../common/same-hex';
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

const DAY_SEC = 24 * 60 * 60;

/** OTP lifecycle. */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    @Inject(MESSAGE_SENDER) private readonly sender: MessageSender,
  ) {}

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
    // Admins sign in by email OTP on every login, so only a student's SMS is counted against a day.
    if (actor === ActorTypes.STUDENT) await this.countTowardsDay(identifier);

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

    await this.deliver(actor, identifier, code, ttlSec);

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

  /** Counted before sending and never refunded: a refused request past the cap is already over it. */
  private async countTowardsDay(mobile: string): Promise<void> {
    const key = redisKeys.otpDaily(mobile);
    const sent = await this.redis.client.incr(key);
    if (sent === 1) await this.redis.client.expire(key, DAY_SEC);
    if (sent > this.config.get('OTP_MAX_PER_DAY')) {
      throw new AppException(
        ErrorCodes.RATE_LIMITED,
        'Too many codes have been sent to this number — try again later',
      );
    }
  }

  /** WhatsApp first where it is on, SMS the moment it does not — a student is waiting. */
  private async deliver(
    actor: ActorType,
    identifier: string,
    code: string,
    ttlSec: number,
  ): Promise<void> {
    const message = {
      kind: MESSAGE_KINDS.OTP,
      to: identifier,
      actor,
      subject: 'Your IACE verification code',
      // The SMS provider fills its DLT template from these; console and email send `body` as written.
      body: `${code} is your IACE verification code. It expires in ${ttlSec} seconds.`,
      data: { code, ttlSec },
    };

    const channel = channelFor(actor, this.config);
    try {
      await this.sender.send({ ...message, channel });
    } catch (error) {
      if (channel !== MESSAGE_CHANNELS.WHATSAPP) throw error;

      this.logger.warn(`WhatsApp OTP failed for ${actor}, falling back to SMS`);
      await this.sender.send({ ...message, channel: MESSAGE_CHANNELS.SMS });
    }
  }

  /**
   * Consumes the pending code. Throws on wrong/expired codes and burns the challenge once the
   * attempt cap is hit, so a code cannot be brute-forced inside its TTL.
   */
  async verify(actor: ActorType, identifier: string, code: string): Promise<void> {
    const key = redisKeys.otp(actor, identifier);
    const stored = await this.redis.getJson<StoredOtp>(key);
    if (!stored)
      throw new AppException(ErrorCodes.OTP_EXPIRED, 'Code has expired — request a new one');

    if (!sameHex(this.hash(code), stored.codeHash)) {
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
}

/**
 * Students are reached on the mobile number they signed up with, admins on their email address —
 * the same split the two identity tables have.
 */
function channelFor(actor: ActorType, config: AppConfigService): MessageChannel {
  if (actor !== ActorTypes.STUDENT) return MESSAGE_CHANNELS.EMAIL;

  return config.get('OTP_SENDER') === OTP_SENDERS.WHATSAPP
    ? MESSAGE_CHANNELS.WHATSAPP
    : MESSAGE_CHANNELS.SMS;
}
