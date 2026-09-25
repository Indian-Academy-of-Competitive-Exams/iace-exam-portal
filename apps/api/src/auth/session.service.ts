import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
  type ActorType,
  type ClientKind,
  type DeviceSession,
} from '@iace/contracts';
import { sameHex } from '../common/same-hex';
import { RedisService } from '../redis/redis.service';
import { redisKeys } from '../redis/redis.keys';
import {
  type DeviceContext,
  type ListedSession,
  type SessionReplacement,
  type StoredSession,
} from './auth.types';

/** Sessions and device binding — Redis only, never Postgres. A session's TTL is the refresh-token lifetime, so expiry is automatic and there is no sweeper. */
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
    // One session per app kind for a student: the newest sign-in of a kind replaces the last.
    if (actor === ActorTypes.STUDENT)
      await this.replaceSameKind(actor, subjectId, device.client, ttlSec);

    const now = new Date().toISOString();
    const session: StoredSession = {
      refreshTokenHash: this.hash(refreshToken),
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      ip: device.ip,
      userAgent: device.userAgent,
      createdAt: now,
      lastSeenAt: now,
      client: device.client,
    };

    await this.redis.setJson(redisKeys.session(actor, subjectId, sessionId), session, ttlSec);

    // Index so "sign out everywhere" doesn't need a KEYS scan.
    const indexKey = redisKeys.sessionIndex(actor, subjectId);
    await this.redis.client.sadd(indexKey, sessionId);
    await this.redis.client.expire(indexKey, ttlSec);
  }

  /** Called by the JWT guard: a revoked session invalidates a still-valid token. */
  async exists(actor: ActorType, subjectId: string, sessionId: string): Promise<boolean> {
    return (await this.redis.client.exists(redisKeys.session(actor, subjectId, sessionId))) === 1;
  }

  /** Verifies the presented refresh token against the stored hash and swaps in the new one. Any mismatch revokes the session outright: either the token was replayed after rotation, or it leaked. */
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
    const raw = await this.redis.getRaw(key);
    const session = raw ? parsedSession(raw) : null;
    if (!session) return this.throwEnded(actor, subjectId, sessionId);

    if (!sameHex(this.hash(presentedToken), session.refreshTokenHash)) {
      await this.revoke(actor, subjectId, sessionId);
      this.logger.warn(`Refresh token reuse detected for ${actor} ${subjectId}; session revoked`);
      throw new AppException(
        ErrorCodes.UNAUTHENTICATED,
        'Session is no longer valid. Sign in again',
      );
    }

    // Device binding: the session stays tied to the device that created it.
    if (session.deviceId && device.deviceId && session.deviceId !== device.deviceId) {
      await this.revoke(actor, subjectId, sessionId);
      throw new AppException(ErrorCodes.UNAUTHENTICATED, 'Session is bound to a different device');
    }

    const next = {
      ...session,
      refreshTokenHash: this.hash(nextToken),
      lastSeenAt: new Date().toISOString(),
    } satisfies StoredSession;
    // Lands only on the bytes read: a replacement or sign-out racing this refresh wins.
    if (!(await this.redis.replaceJson(key, raw, next, ttlSec))) {
      return this.throwEnded(actor, subjectId, sessionId);
    }
    // A refreshing session keeps its place in the index, or revokeAll and the one-per-kind rule lose it.
    const indexKey = redisKeys.sessionIndex(actor, subjectId);
    await this.redis.client.sadd(indexKey, sessionId);
    await this.redis.client.expire(indexKey, ttlSec);
  }

  /** A session that is gone: replaced says so, anything else is an ordinary end. */
  private async throwEnded(actor: ActorType, subjectId: string, sessionId: string): Promise<never> {
    const replaced = await this.replacedBy(actor, subjectId, sessionId);
    if (replaced)
      throw new AppException(ErrorCodes.SESSION_REPLACED, undefined, { details: replaced });
    throw new AppException(ErrorCodes.UNAUTHENTICATED, 'Session has expired. Sign in again');
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

  /** Every live session of a subject with its id; an index entry whose key has expired is skipped. */
  async list(actor: ActorType, subjectId: string): Promise<ListedSession[]> {
    const ids = await this.redis.client.smembers(redisKeys.sessionIndex(actor, subjectId));
    const found = await this.redis.mgetJson<StoredSession>(
      ids.map((id) => redisKeys.session(actor, subjectId, id)),
    );
    return ids.flatMap((id, index) => {
      const session = found[index];
      return session ? [{ ...session, id, client: session.client ?? null }] : [];
    });
  }

  /** The account's devices, newest activity first, with the asking device marked. */
  async devicesFor(
    actor: ActorType,
    subjectId: string,
    currentSessionId: string,
  ): Promise<DeviceSession[]> {
    const listed = await this.list(actor, subjectId);
    return listed
      .map((s) => ({
        id: s.id,
        client: s.client,
        deviceName: s.deviceName,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        current: s.id === currentSessionId,
      }))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  /** Ends one of the subject's OTHER sessions; the device asking signs itself out with logout. */
  async signOutOther(
    actor: ActorType,
    subjectId: string,
    currentSessionId: string,
    sessionId: string,
  ): Promise<void> {
    if (sessionId === currentSessionId) {
      throw new AppException(ErrorCodes.CONFLICT, 'Use Sign out to end the session on this device');
    }
    const owned = (await this.list(actor, subjectId)).some((s) => s.id === sessionId);
    if (!owned) throw new AppException(ErrorCodes.NOT_FOUND, 'No such session');
    await this.revoke(actor, subjectId, sessionId);
  }

  /** Why a missing session ended: who replaced it, or null when it ended any other way. */
  async replacedBy(
    actor: ActorType,
    subjectId: string,
    sessionId: string,
  ): Promise<SessionReplacement | null> {
    return this.redis.getJson<SessionReplacement>(
      redisKeys.sessionReplaced(actor, subjectId, sessionId),
    );
  }

  /** A kind's own sessions go, and any from before kinds were kept; the other kind stays. */
  private async replaceSameKind(
    actor: ActorType,
    subjectId: string,
    client: ClientKind | null,
    ttlSec: number,
  ): Promise<void> {
    for (const listed of await this.list(actor, subjectId)) {
      if (listed.client !== null && listed.client !== client) continue;
      // Written before the revoke: a request landing in between still finds why, not UNAUTHENTICATED.
      await this.redis.setJson(
        redisKeys.sessionReplaced(actor, subjectId, listed.id),
        { replacedBy: client } satisfies SessionReplacement,
        ttlSec,
      );
      await this.revoke(actor, subjectId, listed.id);
    }
  }

  private hash(token: string): string {
    // The token is already a high-entropy signed JWT, so a plain digest is the right tool here — this is theft detection, not password storage.
    return createHash('sha256').update(token).digest('hex');
  }
}

/** A value that does not parse is no session at all, as getJson treats one. */
function parsedSession(raw: string): StoredSession | null {
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}
