import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../redis/redis.service';
import { redisKeys } from '../../redis/redis.keys';

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
 * The 6-digit student login PIN.
 *
 * Two things carry the security here, because six digits is a small secret:
 *
 *  1. A PEPPER — the PIN is HMAC'd with a server-side secret before it is
 *     hashed. The pepper lives in the environment, never beside the hash, so a
 *     stolen Student table cannot be brute-forced offline (a million candidates
 *     is otherwise minutes of work).
 *  2. A LOCKOUT — consecutive failures are counted in Redis and the number is
 *     locked out for a cooldown once the cap is hit, which is what actually
 *     stops online guessing.
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

  get lockoutSec(): number {
    return this.config.get('PIN_LOCKOUT_SEC');
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
    this.decoyHash ??= this.hash('000000');
    await this.verify(await this.decoyHash, '000001');
  }

  // ==========================================================================
  // Attempt limiting — the real defence for a 6-digit secret
  // ==========================================================================

  /** Call before checking a PIN. Throws 429 while the number is locked out. */
  async assertNotLocked(mobile: string): Promise<void> {
    const remaining = await this.redis.ttl(redisKeys.pinLock(mobile));
    if (remaining > 0) {
      throw new HttpException(
        `Too many incorrect attempts. Try again in ${Math.ceil(remaining / 60)} minute(s), or reset your PIN.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Records a wrong PIN and locks the number once the cap is reached. The
   * counter window is the lockout duration, so isolated typos age out instead
   * of stacking up over days.
   */
  async registerFailure(mobile: string): Promise<void> {
    const key = redisKeys.pinAttempts(mobile);
    const attempts = await this.redis.client.incr(key);
    if (attempts === 1) await this.redis.client.expire(key, this.lockoutSec);

    if (attempts >= this.maxAttempts) {
      await this.redis.client.set(redisKeys.pinLock(mobile), '1', 'EX', this.lockoutSec);
      await this.redis.del(key);
    }
  }

  /** A correct PIN (or a fresh one) wipes the slate. */
  async clearFailures(mobile: string): Promise<void> {
    await this.redis.del(redisKeys.pinAttempts(mobile), redisKeys.pinLock(mobile));
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
      throw new UnauthorizedException('This link has expired — verify your mobile number again');
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
