import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { AppException, type ActorType } from '@iace/contracts';
import { RedisService } from '../redis/redis.service';
import { redisKeys } from '../redis/redis.keys';
import { type DeviceContext, type StoredSession } from './auth.types';

/**
 * Sessions and device binding — Redis only, never Postgres. A session's TTL is
 * the refresh-token lifetime, so expiry is automatic and there is no sweeper.
 *
 * Two properties we get from keeping the session server-side:
 *   - logout is instant (the key is gone, so the access token stops working);
 *   - a stolen refresh token is detectable, because tokens rotate on every use
 *     and a replay of the old one no longer matches the stored hash.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(private readonly redis: RedisService) {}

  newSessionId(): string {
    return randomUUID();
  }

  async create(
    actor: ActorType,
    subjectId: string,
    sessionId: string,
    refreshToken: string,
    device: DeviceContext,
    ttlSec: number,
  ): Promise<void> {
    const now = new Date().toISOString();
    const session: StoredSession = {
      refreshTokenHash: this.hash(refreshToken),
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      ip: device.ip,
      userAgent: device.userAgent,
      createdAt: now,
      lastSeenAt: now,
    };

    await this.redis.setJson(redisKeys.session(actor, subjectId, sessionId), session, ttlSec);

    // Index so "sign out everywhere" doesn't need a KEYS scan.
    const indexKey = redisKeys.sessionIndex(actor, subjectId);
    await this.redis.client.sadd(indexKey, sessionId);
    await this.redis.client.expire(indexKey, ttlSec);
  }

  async get(actor: ActorType, subjectId: string, sessionId: string): Promise<StoredSession | null> {
    return this.redis.getJson<StoredSession>(redisKeys.session(actor, subjectId, sessionId));
  }

  /** Called by the JWT guard: a revoked session invalidates a still-valid token. */
  async exists(actor: ActorType, subjectId: string, sessionId: string): Promise<boolean> {
    return (await this.redis.client.exists(redisKeys.session(actor, subjectId, sessionId))) === 1;
  }

  /**
   * Verifies the presented refresh token against the stored hash and swaps in
   * the new one. Any mismatch revokes the session outright: either the token
   * was replayed after rotation, or it leaked.
   */
  async rotate(
    actor: ActorType,
    subjectId: string,
    sessionId: string,
    presentedToken: string,
    nextToken: string,
    device: DeviceContext,
    ttlSec: number,
  ): Promise<void> {
    const key = redisKeys.session(actor, subjectId, sessionId);
    const session = await this.redis.getJson<StoredSession>(key);
    if (!session) throw new AppException('UNAUTHENTICATED', 'Session has expired — sign in again');

    if (!this.matches(presentedToken, session.refreshTokenHash)) {
      await this.revoke(actor, subjectId, sessionId);
      this.logger.warn(`Refresh token reuse detected for ${actor} ${subjectId}; session revoked`);
      throw new AppException('UNAUTHENTICATED', 'Session is no longer valid — sign in again');
    }

    // Device binding: the session stays tied to the device that created it.
    if (session.deviceId && device.deviceId && session.deviceId !== device.deviceId) {
      await this.revoke(actor, subjectId, sessionId);
      throw new AppException('UNAUTHENTICATED', 'Session is bound to a different device');
    }

    await this.redis.setJson(
      key,
      {
        ...session,
        refreshTokenHash: this.hash(nextToken),
        lastSeenAt: new Date().toISOString(),
      } satisfies StoredSession,
      ttlSec,
    );
  }

  async revoke(actor: ActorType, subjectId: string, sessionId: string): Promise<void> {
    await this.redis.del(redisKeys.session(actor, subjectId, sessionId));
    await this.redis.client.srem(redisKeys.sessionIndex(actor, subjectId), sessionId);
  }

  /** Sign out everywhere — used on account deactivation and by the user. */
  async revokeAll(actor: ActorType, subjectId: string): Promise<void> {
    const indexKey = redisKeys.sessionIndex(actor, subjectId);
    const sessionIds = await this.redis.client.smembers(indexKey);
    await this.redis.del(
      ...sessionIds.map((id) => redisKeys.session(actor, subjectId, id)),
      indexKey,
    );
  }

  private hash(token: string): string {
    // The token is already a high-entropy signed JWT, so a plain digest is the
    // right tool here — this is theft detection, not password storage.
    return createHash('sha256').update(token).digest('hex');
  }

  private matches(token: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hash(token), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
