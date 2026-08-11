import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import { AppException, ErrorCodes } from '@iace/contracts';
import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../redis/redis.service';
import { redisKeys } from '../../redis/redis.keys';
import { secondsToHuman } from '../../common/duration';

/**
 * Picks the rung: the 1st lockout gets the 1st step, the 2nd the 2nd, and
 * anything past the end of the ladder stays on the last one. Pure, so the
 * escalation can be tested without Redis.
 */
export function lockoutDurationFor(steps: number[], lockoutCount: number): number {
  const index = Math.min(Math.max(lockoutCount, 1), steps.length) - 1;
  // steps is validated non-empty at boot; the fallback keeps the type honest.
  return steps[index] ?? steps[steps.length - 1] ?? 900;
}

/**
 * OWASP's low-memory argon2id profile (19 MiB, t=2, p=1). It costs ~20ms per
 * verify here, which is the right trade for a login that runs once a day per
 * student rather than once per request.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * The 4-digit student login PIN.
 *
 * Two things carry the security here, because four digits is a very small
 * secret — 10,000 possibilities, not a million:
 *
 *  1. A PEPPER — the PIN is HMAC'd with a server-side secret before it is
 *     hashed. The pepper lives in the environment, never beside the hash, so a
 *     stolen Student table cannot be brute-forced offline (10,000 candidates
 *     is otherwise a fraction of a second's work).
 *  2. An ESCALATING LOCKOUT — consecutive failures are counted in Redis and the
 *     number is locked out once the cap is hit, for LONGER each time it
 *     happens again (15 minutes → 1 hour → 1 day). This is what actually stops
 *     online guessing: a fixed cooldown can simply be waited out, and at five
 *     tries per quarter-hour the whole 10,000-PIN space falls in about three
 *     weeks.
 *
 * Every counter, lock and setup ticket is Redis-only with a TTL: nothing to
 * expire by hand, nothing mirrored into Postgres.
 */
@Injectable()
export class PinService {
  /** Verified against on unknown mobiles so a login costs the same either way. */
  private decoyHash: Promise<string> | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {}

  get maxAttempts(): number {
    return this.config.get('PIN_MAX_ATTEMPTS');
  }

  /** The escalation ladder, in seconds. The last rung repeats forever. */
  get lockoutSteps(): number[] {
    return this.config.get('PIN_LOCKOUT_STEPS_SEC');
  }

  /**
   * How long the wrong-attempt counter lives. The first rung doubles as this
   * window, so an isolated typo today never joins forces with one next week.
   */
  get attemptWindowSec(): number {
    return lockoutDurationFor(this.lockoutSteps, 1);
  }

  get lockoutDecaySec(): number {
    return this.config.get('PIN_LOCKOUT_DECAY_SEC');
  }

  get setupTtlSec(): number {
    return this.config.get('PIN_SETUP_TTL_SEC');
  }

  // ==========================================================================
  // Hashing
  // ==========================================================================

  hash(pin: string): Promise<string> {
    return argon2.hash(this.pepper(pin), ARGON2_OPTIONS);
  }

  async verify(hash: string, pin: string): Promise<boolean> {
    try {
      // No options here on purpose: argon2 reads the cost parameters back out
      // of the encoded hash, so raising ARGON2_OPTIONS later still verifies
      // every PIN hashed under the old settings.
      return await argon2.verify(hash, this.pepper(pin));
    } catch {
      // A malformed or foreign hash is a failed login, not a 500.
      return false;
    }
  }

  /**
   * Burns the same ~20ms as a real verify when there is no account to check
   * against, so response time cannot be used to test whether a number is
   * registered.
   */
  async burnVerifyTime(): Promise<void> {
    this.decoyHash ??= this.hash('0000');
    await this.verify(await this.decoyHash, '0001');
  }

  // ==========================================================================
  // Attempt limiting — the real defence for a 4-digit secret
  // ==========================================================================

  /** Call before checking a PIN. Throws PIN_LOCKED while the number is locked. */
  async assertNotLocked(mobile: string): Promise<void> {
    const remaining = await this.redis.ttl(redisKeys.pinLock(mobile));
    if (remaining > 0) {
      throw new AppException(
        ErrorCodes.PIN_LOCKED,
        `Too many incorrect attempts. Try again in ${secondsToHuman(remaining)}, or reset your PIN.`,
        { details: { retryAfterSec: remaining } },
      );
    }
  }

  /**
   * Records a wrong PIN and locks the number once the cap is reached — each
   * time for LONGER than the last.
   *
   * Waiting out a fixed 15 minutes and starting again is a viable attack on a
   * 4-digit PIN: five tries a quarter-hour is ~480 a day, and the whole space
   * is 10,000. Climbing to an hour and then a day turns that into a handful of
   * guesses a day, while a student who mistypes twice in a morning never
   * notices the ladder exists.
   */
  async registerFailure(mobile: string): Promise<void> {
    const key = redisKeys.pinAttempts(mobile);
    const attempts = await this.redis.client.incr(key);
    if (attempts === 1) await this.redis.client.expire(key, this.attemptWindowSec);
    if (attempts < this.maxAttempts) return;

    // Nth lockout for this number → Nth rung. The counter outlives the lockout
    // it causes (plus the decay window), so waiting one out and starting over
    // climbs instead of resetting.
    const lockoutsKey = redisKeys.pinLockouts(mobile);
    const lockouts = await this.redis.client.incr(lockoutsKey);
    const lockoutSec = lockoutDurationFor(this.lockoutSteps, lockouts);

    await this.redis.client.expire(lockoutsKey, lockoutSec + this.lockoutDecaySec);
    await this.redis.client.set(redisKeys.pinLock(mobile), '1', 'EX', lockoutSec);
    await this.redis.del(key);
  }

  /**
   * A correct PIN (or a fresh one) wipes the slate, ladder included: whoever
   * did that holds the PIN or has just proved they hold the number, and both
   * are the owner. It is also what stops the escalation from punishing a
   * student who simply forgot and reset.
   */
  async clearFailures(mobile: string): Promise<void> {
    await this.redis.del(
      redisKeys.pinAttempts(mobile),
      redisKeys.pinLock(mobile),
      redisKeys.pinLockouts(mobile),
    );
  }

  // ==========================================================================
  // Setup ticket — the bridge between "OTP verified" and "PIN set"
  // ==========================================================================

  /**
   * Issued the moment an OTP checks out. It is what lets the PIN screen be a
   * separate step: the student is not signed in yet, but they have proved they
   * hold the number, and that proof is good for a few minutes.
   */
  async issueSetupToken(mobile: string): Promise<{ setupToken: string; expiresInSec: number }> {
    const setupToken = randomBytes(32).toString('hex');
    await this.redis.client.set(
      redisKeys.pinSetup(mobile),
      this.digest(setupToken),
      'EX',
      this.setupTtlSec,
    );
    return { setupToken, expiresInSec: this.setupTtlSec };
  }

  /** Single use: redeeming it deletes it, so one OTP sets exactly one PIN. */
  async consumeSetupToken(mobile: string, setupToken: string): Promise<void> {
    const key = redisKeys.pinSetup(mobile);
    const stored = await this.redis.client.get(key);
    if (!stored || !this.digestMatches(setupToken, stored)) {
      // The ticket is the OTP's continuation, so an expired one sends the
      // student back to the same place a stale code would.
      throw new AppException(
        ErrorCodes.OTP_EXPIRED,
        'This step has expired — verify your mobile number again',
      );
    }
    await this.redis.del(key);
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private pepper(pin: string): string {
    return createHmac('sha256', this.config.get('PIN_PEPPER')).update(pin).digest('hex');
  }

  /** The ticket is already 256 bits of CSPRNG output, so a plain digest is the
   *  right tool — this is a lookup handle, not a password. */
  private digest(token: string): string {
    return createHmac('sha256', this.config.get('PIN_PEPPER')).update(token).digest('hex');
  }

  private digestMatches(token: string, expected: string): boolean {
    const actual = Buffer.from(this.digest(token), 'hex');
    const target = Buffer.from(expected, 'hex');
    return actual.length === target.length && timingSafeEqual(actual, target);
  }
}
