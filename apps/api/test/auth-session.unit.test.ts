import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActorTypes, AppException } from '@iace/contracts';
import { SessionService } from '../src/auth/session.service';
import { FakeRedis, NO_DEVICE } from './support/fakes';

/**
 * Sessions live only in Redis. Two properties earn that: logout takes effect at once, and a
 * replayed refresh token is detectable because tokens rotate.
 */

const SUBJECT = 'stu_1';
const TTL = 3600;

function build() {
  const redis = new FakeRedis();
  return { redis, sessions: new SessionService(redis.asService()) };
}

async function openSession(sessions: SessionService, token = 'refresh-1', device = NO_DEVICE) {
  const sessionId = sessions.newSessionId();
  await sessions.create(ActorTypes.STUDENT, SUBJECT, sessionId, token, device, TTL);
  return sessionId;
}

describe('SessionService', () => {
  it('creates a session the guard can find', async () => {
    const { sessions } = build();
    const sessionId = await openSession(sessions);

    assert.equal(await sessions.exists(ActorTypes.STUDENT, SUBJECT, sessionId), true);
  });

  it('stores a hash of the refresh token, never the token', async () => {
    const { sessions, redis } = build();
    const sessionId = await openSession(sessions, 'the-actual-refresh-token');

    const stored = redis.snapshot()[`session:student:${SUBJECT}:${sessionId}`];
    assert.ok(typeof stored === 'string');
    assert.ok(!stored.includes('the-actual-refresh-token'));
    assert.match(JSON.parse(stored).refreshTokenHash, /^[0-9a-f]{64}$/);
  });

  it('rotates: the new token is accepted next time', async () => {
    const { sessions } = build();
    const sessionId = await openSession(sessions, 'refresh-1');

    await sessions.rotate(
      ActorTypes.STUDENT,
      SUBJECT,
      sessionId,
      'refresh-1',
      'refresh-2',
      NO_DEVICE,
      TTL,
    );

    await assert.doesNotReject(() =>
      sessions.rotate(
        ActorTypes.STUDENT,
        SUBJECT,
        sessionId,
        'refresh-2',
        'refresh-3',
        NO_DEVICE,
        TTL,
      ),
    );
  });

  it('detects a replayed refresh token and kills the session', async () => {
    const { sessions } = build();
    const sessionId = await openSession(sessions, 'refresh-1');
    await sessions.rotate(
      ActorTypes.STUDENT,
      SUBJECT,
      sessionId,
      'refresh-1',
      'refresh-2',
      NO_DEVICE,
      TTL,
    );

    // Someone presenting the pre-rotation token either stole it or is a stale
    // client; either way the safe reading is that it leaked.
    await assert.rejects(
      () =>
        sessions.rotate(
          ActorTypes.STUDENT,
          SUBJECT,
          sessionId,
          'refresh-1',
          'refresh-9',
          NO_DEVICE,
          TTL,
        ),
      (e: unknown) => AppException.is(e) && e.code === 'UNAUTHENTICATED',
    );

    // And the whole session goes, not just that one request — the thief and the
    // victim are both signed out, which is the point.
    assert.equal(await sessions.exists(ActorTypes.STUDENT, SUBJECT, sessionId), false);
  });

  it('refuses to rotate a session bound to a different device', async () => {
    const { sessions } = build();
    const sessionId = await openSession(sessions, 'refresh-1', {
      ...NO_DEVICE,
      deviceId: 'phone-a',
    });

    await assert.rejects(
      () =>
        sessions.rotate(
          ActorTypes.STUDENT,
          SUBJECT,
          sessionId,
          'refresh-1',
          'refresh-2',
          {
            ...NO_DEVICE,
            deviceId: 'phone-b',
          },
          TTL,
        ),
      (e: unknown) => AppException.is(e) && e.code === 'UNAUTHENTICATED',
    );
    assert.equal(await sessions.exists(ActorTypes.STUDENT, SUBJECT, sessionId), false);
  });

  it('rejects rotation of a session that has expired', async () => {
    const { sessions, redis } = build();
    const sessionId = await openSession(sessions, 'refresh-1');
    redis.advanceSeconds(TTL + 1);

    await assert.rejects(
      () =>
        sessions.rotate(
          ActorTypes.STUDENT,
          SUBJECT,
          sessionId,
          'refresh-1',
          'refresh-2',
          NO_DEVICE,
          TTL,
        ),
      (e: unknown) => AppException.is(e) && e.code === 'UNAUTHENTICATED',
    );
  });

  it('revoke makes a still-valid access token stop working immediately', async () => {
    const { sessions } = build();
    const sessionId = await openSession(sessions);

    await sessions.revoke(ActorTypes.STUDENT, SUBJECT, sessionId);

    // The JWT has not expired — the guard's Redis check is what ends it.
    assert.equal(await sessions.exists(ActorTypes.STUDENT, SUBJECT, sessionId), false);
  });

  it('revokeAll signs out every device at once', async () => {
    const { sessions } = build();
    const a = await openSession(sessions, 'r-a');
    const b = await openSession(sessions, 'r-b');
    const c = await openSession(sessions, 'r-c');

    await sessions.revokeAll(ActorTypes.STUDENT, SUBJECT);

    for (const id of [a, b, c]) {
      assert.equal(await sessions.exists(ActorTypes.STUDENT, SUBJECT, id), false);
    }
  });

  it('keeps students and admins apart even on the same id', async () => {
    const { sessions } = build();
    const sessionId = sessions.newSessionId();
    await sessions.create(ActorTypes.STUDENT, SUBJECT, sessionId, 'r', NO_DEVICE, TTL);

    assert.equal(await sessions.exists(ActorTypes.ADMIN, SUBJECT, sessionId), false);
  });

  it('expires on its own, so there is no sweeper to forget to run', async () => {
    const { sessions, redis } = build();
    const sessionId = await openSession(sessions);

    redis.advanceSeconds(TTL + 1);

    assert.equal(await sessions.exists(ActorTypes.STUDENT, SUBJECT, sessionId), false);
  });
});
