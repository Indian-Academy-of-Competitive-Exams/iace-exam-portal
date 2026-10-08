import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomInt } from 'node:crypto';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
  OTP_CHANNELS,
  type ActorType,
  type OtpChannel,
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

/** How long a code the desk reads out is good for. Short: it is said aloud, to somebody standing there. */
export const DESK_CODE_TTL_SEC = 5 * 60;

/** What a student's request may say beyond the number: whether it holds an account, and the channel wanted. */
interface StudentAsk {
  holdsAccount?: boolean;
  channel?: OtpChannel;
}

const MESSAGE_CHANNEL_OF: Record<OtpChannel, MessageChannel> = {
  [OTP_CHANNELS.SMS]: MESSAGE_CHANNELS.SMS,
  [OTP_CHANNELS.WHATSAPP]: MESSAGE_CHANNELS.WHATSAPP,
};

/** One day's spend on codes, counted and refused on its own. */
interface DailyBudget {
  counter: string;
  setting: 'OTP_GLOBAL_DAILY_BUDGET_PAISE' | 'OTP_SIGNUP_DAILY_BUDGET_PAISE';
  refusal: 'refused_budget' | 'refused_signup_budget';
}

const STUDENT_BUDGET: DailyBudget = {
  counter: redisKeys.otpDailyGlobal,
  setting: 'OTP_GLOBAL_DAILY_BUDGET_PAISE',
  refusal: 'refused_budget',
};

/** Apart from the students': every sign-in is a code now, so a stranger spending theirs would lock them all out. */
const SIGNUP_BUDGET: DailyBudget = {
  counter: redisKeys.otpDailySignup,
  setting: 'OTP_SIGNUP_DAILY_BUDGET_PAISE',
  refusal: 'refused_signup_budget',
};

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

  async request(
    actor: ActorType,
    identifier: string,
    ip = 'unknown',
    { holdsAccount = true, channel }: StudentAsk = {},
  ): Promise<OtpRequestResponse> {
    const cooldownKey = redisKeys.otpCooldown(actor, identifier);
    const cooldownSec = this.config.get('OTP_RESEND_COOLDOWN_SEC');
    // Claimed in one step, before anything is spent: of two requests landing together, one sends.
    if (
      cooldownSec > 0 &&
      (await this.redis.client.set(cooldownKey, '1', 'EX', cooldownSec, 'NX')) !== 'OK'
    ) {
      const remaining = Math.max(await this.redis.ttl(cooldownKey), 1);
      throw new AppException(
        ErrorCodes.RATE_LIMITED,
        `Please wait ${remaining}s before requesting another code`,
        { details: { retryAfterSec: remaining } },
      );
    }
    // Admins sign in by email OTP on every login, so only a student's paid send is metered.
    if (actor === ActorTypes.STUDENT) {
      try {
        await this.countTowardsDay(identifier);
        await this.assertIpDailyBudget(ip);
        await this.assertDailyBudget(holdsAccount ? STUDENT_BUDGET : SIGNUP_BUDGET);
      } catch (error) {
        // The day's refusal is the whole answer: it leaves no wait behind it.
        await this.redis.del(cooldownKey);
        throw error;
      }
    }

    const ttlSec = this.config.get('OTP_TTL_SEC');
    const code = this.generateCode();

    // The cooldown stays: the day's counters are spent, and it paces a retry through an outage.
    const sentOn = await this.deliver(actor, identifier, code, ttlSec, channel).catch(
      (error: unknown) => {
        this.logger.error(`An OTP for ${actor} could not be sent`, error);
        throw new AppException(
          ErrorCodes.SERVICE_UNAVAILABLE,
          'The code could not be sent. Try again in a moment',
          { details: { retryAfterSec: cooldownSec } },
        );
      },
    );
    if (actor === ActorTypes.STUDENT) this.metrics.countOtpSend('sent');

    // Stored only once it has left: a code that was never sent must not replace one that was.
    const stored: StoredOtp = {
      codeHash: this.hash(code),
      createdAt: new Date().toISOString(),
    };
    await this.redis.setJson(redisKeys.otp(actor, identifier), stored, ttlSec);
    // A fresh code resets the attempt count: the old key's leftover count must not carry over.
    await this.redis.del(redisKeys.otpAttempts(actor, identifier));

    return {
      sent: true,
      expiresInSec: ttlSec,
      resendAfterSec: cooldownSec,
      codeLength: code.length,
      ...whereItWent(sentOn, this.config),
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

  /** The kill switch on the bill: past a day's budget its callers wait for tomorrow, and only its callers. */
  private async assertDailyBudget(budget: DailyBudget): Promise<void> {
    const sent = await this.incrementDailyCounter(budget.counter);

    const budgetPaise = this.config.get(budget.setting);
    const maxSends = Math.floor(budgetPaise / this.config.get('NOTIFICATION_COST_SMS_PAISE'));
    if (sent > maxSends) {
      this.metrics.countOtpSend(budget.refusal);
      this.logger.error(`${budget.setting} of ${budgetPaise}p exhausted: ${sent} sends today`);
      throw new AppException(
        ErrorCodes.RATE_LIMITED,
        'Verification codes are paused for today. Please try again tomorrow or contact your branch',
      );
    }
  }

  /** On the one channel chosen, and never two. A WhatsApp send that fails goes by SMS at once — a student is waiting. */
  private async deliver(
    actor: ActorType,
    identifier: string,
    code: string,
    ttlSec: number,
    asked?: OtpChannel,
  ): Promise<OtpChannel | undefined> {
    const message = {
      kind: MESSAGE_KINDS.OTP,
      to: identifier,
      actor,
      subject: 'Your IACE verification code',
      // The SMS provider fills its DLT template from these; console and email send `body` as written.
      body: `${code} is your IACE verification code. It expires in ${ttlSec} seconds.`,
      data: { code, ttlSec },
    };
    // Admins are reached on their email address, students on their mobile: the split the two identity tables have.
    if (actor !== ActorTypes.STUDENT) {
      await this.sender.send({ ...message, channel: MESSAGE_CHANNELS.EMAIL });
      return undefined;
    }

    const offered = studentChannels(this.config);
    const chosen = asked !== undefined && offered.includes(asked) ? asked : offered[0];
    try {
      await this.sender.send({ ...message, channel: MESSAGE_CHANNEL_OF[chosen] });
      return chosen;
    } catch (error) {
      if (chosen !== OTP_CHANNELS.WHATSAPP) throw error;

      this.logger.warn(`WhatsApp OTP failed for ${actor}, falling back to SMS`);
      await this.sender.send({ ...message, channel: MESSAGE_CHANNEL_OF[OTP_CHANNELS.SMS] });
      return OTP_CHANNELS.SMS;
    }
  }

  /** A code read out at the desk when the sent one will not arrive. Kept beside it, so a resend cannot replace it. */
  async issueDeskCode(mobile: string): Promise<{ code: string; expiresInSec: number }> {
    const code = this.generateCode();
    const stored: StoredOtp = { codeHash: this.hash(code), createdAt: new Date().toISOString() };
    await this.redis.setJson(redisKeys.otpDesk(mobile), stored, DESK_CODE_TTL_SEC);
    // Its own five guesses: a count left by the sent code must not burn this one on the first slip.
    await this.redis.del(redisKeys.otpAttempts(ActorTypes.STUDENT, mobile));
    return { code, expiresInSec: DESK_CODE_TTL_SEC };
  }

  /** Consumes the pending code. Throws on wrong/expired codes and burns the challenge once the attempt cap is hit, so a code cannot be brute-forced inside its TTL. */
  async verify(actor: ActorType, identifier: string, code: string): Promise<void> {
    // A student may hold two at once: the one that was sent, and one the desk read out.
    const keys =
      actor === ActorTypes.STUDENT
        ? [redisKeys.otp(actor, identifier), redisKeys.otpDesk(identifier)]
        : [redisKeys.otp(actor, identifier)];
    const pending = await Promise.all(keys.map((key) => this.redis.getJson<StoredOtp>(key)));
    if (pending.every((stored) => stored === null)) throw codeExpired();

    const hashed = this.hash(code);
    const attemptsKey = redisKeys.otpAttempts(actor, identifier);
    const cooldownKey = redisKeys.otpCooldown(actor, identifier);
    if (!pending.some((stored) => stored !== null && sameHex(hashed, stored.codeHash))) {
      // INCR is one atomic op in Redis, so N concurrent guesses consume N attempts, never one.
      const attempts = await this.redis.client.incr(attemptsKey);
      if (attempts === 1) {
        const ttl = Math.max(...(await Promise.all(keys.map((key) => this.redis.ttl(key)))));
        await this.redis.client.expire(attemptsKey, ttl > 0 ? ttl : 1);
      }
      const maxAttempts = this.config.get('OTP_MAX_VERIFY_ATTEMPTS');
      if (attempts >= maxAttempts) {
        await this.redis.del(...keys, attemptsKey, cooldownKey);
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

    // Single use: one DEL takes the code with its twin, so a verification that lost the race finds nothing to take.
    if ((await this.redis.client.del(...keys)) === 0) throw codeExpired();
    await this.redis.del(cooldownKey, attemptsKey);
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

/** One refusal for a code that ran out and a code already spent: the two must read alike. */
function codeExpired(): AppException {
  return new AppException(ErrorCodes.OTP_EXPIRED, 'Code has expired. Request a new one');
}

/** The channels a student's code can go out on here, first choice first. */
function studentChannels(config: AppConfigService): [OtpChannel, ...OtpChannel[]] {
  switch (config.get('OTP_SENDER')) {
    // Billed on delivery, so it goes first; SMS is what a student asks for when it does not arrive.
    case OTP_SENDERS.WHATSAPP:
      return [OTP_CHANNELS.WHATSAPP, OTP_CHANNELS.SMS];
    // Nothing is sent, so both are offered: the choice can be walked through with no provider.
    case OTP_SENDERS.CONSOLE:
      return [OTP_CHANNELS.SMS, OTP_CHANNELS.WHATSAPP];
    default:
      return [OTP_CHANNELS.SMS];
  }
}

/** What the answer says of a student's code: where it went, and what they may ask for instead. */
function whereItWent(
  sentOn: OtpChannel | undefined,
  config: AppConfigService,
): Pick<OtpRequestResponse, 'channel' | 'otherChannel'> {
  if (sentOn === undefined) return {};
  const otherChannel = studentChannels(config).find((channel) => channel !== sentOn);
  return { channel: sentOn, ...(otherChannel ? { otherChannel } : {}) };
}
