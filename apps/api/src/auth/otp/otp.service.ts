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
import { MetricsService } from '../../common/metrics';
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
    private readonly metrics: MetricsService,
  ) {}

  async request(actor: ActorType, identifier: string, ip = 'unknown'): Promise<OtpRequestResponse> {
    const cooldownKey = redisKeys.otpCooldown(actor, identifier);
    const remaining = await this.redis.ttl(cooldownKey);
    if (remaining > 0) {
      throw new AppException(
        ErrorCodes.RATE_LIMITED,
        `Please wait ${remaining}s before requesting another code`,
        { details: { retryAfterSec: remaining } },
      );
    }
    // Admins sign in by email OTP on every login, so only a student's paid send is metered.
    if (actor === ActorTypes.STUDENT) {
      await this.countTowardsDay(identifier);
      await this.assertIpDailyBudget(ip);
      await this.assertGlobalDailyBudget();
    }

    const ttlSec = this.config.get('OTP_TTL_SEC');
    const cooldownSec = this.config.get('OTP_RESEND_COOLDOWN_SEC');
    const code = this.generateCode();

    const stored: StoredOtp = {
      codeHash: this.hash(code),
      createdAt: new Date().toISOString(),
    };
    await this.redis.setJson(redisKeys.otp(actor, identifier), stored, ttlSec);
    // A fresh code resets the attempt count: the old key's leftover count must not carry over.
    await this.redis.del(redisKeys.otpAttempts(actor, identifier));
    if (cooldownSec > 0) {
      await this.redis.client.set(cooldownKey, '1', 'EX', cooldownSec);
    }

    await this.deliver(actor, identifier, code, ttlSec);
    if (actor === ActorTypes.STUDENT) this.metrics.countOtpSend('sent');

    return {
      sent: true,
      expiresInSec: ttlSec,
      resendAfterSec: cooldownSec,
      codeLength: code.length,
      // Convenience for local development only — never with a real sender, and never outside development.
      ...(this.config.get('OTP_SENDER') === OTP_SENDERS.CONSOLE && this.config.isDevelopment
        ? { devCode: code }
        : {}),
    };
  }

  /** INCR then guarantee a TTL, checked every call: a crash between the two commands would otherwise leave a counter that counts up forever. */
  private async incrementDailyCounter(key: string): Promise<number> {
    const count = await this.redis.client.incr(key);
    if ((await this.redis.client.ttl(key)) < 0) await this.redis.client.expire(key, DAY_SEC);
    return count;
  }

  /** Counted before sending and never refunded: a refused request past the cap is already over it. */
  private async countTowardsDay(mobile: string): Promise<void> {
    const sent = await this.incrementDailyCounter(redisKeys.otpDaily(mobile));
    if (sent > this.config.get('OTP_MAX_PER_DAY')) {
      this.metrics.countOtpSend('refused_mobile_daily');
      throw new AppException(
        ErrorCodes.RATE_LIMITED,
        'Too many codes have been sent to this number. Try again later',
      );
    }
  }

  /** The address-wide twin of `countTowardsDay`: a mobile's cap alone does not stop one address minting new numbers. */
  private async assertIpDailyBudget(ip: string): Promise<void> {
    const sent = await this.incrementDailyCounter(redisKeys.otpDailyByIp(ip));
    if (sent > this.config.get('OTP_MAX_PER_DAY_PER_IP')) {
      this.metrics.countOtpSend('refused_ip_daily');
      throw new AppException(
        ErrorCodes.RATE_LIMITED,
        'Too many codes have been requested from this network today. Try again tomorrow',
      );
    }
  }

  /** The platform-wide kill switch: once today's spend would cross the budget, every student waits for tomorrow rather than the bill growing unbounded. */
  private async assertGlobalDailyBudget(): Promise<void> {
    const sent = await this.incrementDailyCounter(redisKeys.otpDailyGlobal);

    const budgetPaise = this.config.get('OTP_GLOBAL_DAILY_BUDGET_PAISE');
    const maxSends = Math.floor(budgetPaise / this.config.get('NOTIFICATION_COST_SMS_PAISE'));
    if (sent > maxSends) {
      this.metrics.countOtpSend('refused_budget');
      this.logger.error(`OTP daily budget of ${budgetPaise}p exhausted: ${sent} sends today`);
      throw new AppException(
        ErrorCodes.RATE_LIMITED,
        'Verification codes are paused for today. Please try again tomorrow or contact your branch',
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

  /** Consumes the pending code. Throws on wrong/expired codes and burns the challenge once the attempt cap is hit, so a code cannot be brute-forced inside its TTL. */
  async verify(actor: ActorType, identifier: string, code: string): Promise<void> {
    const key = redisKeys.otp(actor, identifier);
    const stored = await this.redis.getJson<StoredOtp>(key);
    if (!stored)
      throw new AppException(ErrorCodes.OTP_EXPIRED, 'Code has expired. Request a new one');

    if (!sameHex(this.hash(code), stored.codeHash)) {
      const attemptsKey = redisKeys.otpAttempts(actor, identifier);
      // INCR is one atomic op in Redis, so N concurrent guesses consume N attempts, never one.
      const attempts = await this.redis.client.incr(attemptsKey);
      if (attempts === 1) {
        const ttl = await this.redis.ttl(key);
        await this.redis.client.expire(attemptsKey, ttl > 0 ? ttl : 1);
      }
      const maxAttempts = this.config.get('OTP_MAX_VERIFY_ATTEMPTS');
      if (attempts >= maxAttempts) {
        await this.redis.del(key, attemptsKey);
        // The challenge is burnt, not just wrong — a different code, because the client's next step is "request a new one", not "try again".
        throw new AppException(
          ErrorCodes.RATE_LIMITED,
          'Too many incorrect attempts. Request a new code',
        );
      }
      throw new AppException(ErrorCodes.OTP_INVALID, 'Incorrect code', {
        fieldErrors: { code: ['Incorrect code'] },
        details: { attemptsRemaining: maxAttempts - attempts },
      });
    }

    // Single use: a verified code is gone, and the next resend is immediate.
    await this.redis.del(
      key,
      redisKeys.otpCooldown(actor, identifier),
      redisKeys.otpAttempts(actor, identifier),
    );
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

/** Students are reached on the mobile number they signed up with, admins on their email address — the same split the two identity tables have. */
function channelFor(actor: ActorType, config: AppConfigService): MessageChannel {
  if (actor !== ActorTypes.STUDENT) return MESSAGE_CHANNELS.EMAIL;

  return config.get('OTP_SENDER') === OTP_SENDERS.WHATSAPP
    ? MESSAGE_CHANNELS.WHATSAPP
    : MESSAGE_CHANNELS.SMS;
}
