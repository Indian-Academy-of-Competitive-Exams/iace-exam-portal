import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ActorTypes,
  type ActorType,
  AppException,
  CLIENT_KINDS,
  ErrorCodes,
} from '@iace/contracts';
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

async function openSession(
  sessions: SessionService,
  token = 'refresh-1',
  device = NO_DEVICE,
  actor: ActorType = ActorTypes.STUDENT,
) {
  const sessionId = sessions.newSessionId();
  await sessions.create(actor, SUBJECT, sessionId, token, device, TTL);
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

describe('SessionService — one session per app kind', () => {
  const web = { ...NO_DEVICE, client: CLIENT_KINDS.WEB };
  const mobile = { ...NO_DEVICE, client: CLIENT_KINDS.MOBILE };

  it('a second web sign-in replaces the first and keeps the phone', async () => {
    const { sessions } = build();
    const firstWeb = await openSession(sessions, 'r1', web);
    const phone = await openSession(sessions, 'r2', mobile);
    await openSession(sessions, 'r3', web);

    assert.equal(await sessions.exists(ActorTypes.STUDENT, SUBJECT, firstWeb), false);
    assert.equal(await sessions.exists(ActorTypes.STUDENT, SUBJECT, phone), true);
    assert.deepEqual(await sessions.replacedBy(ActorTypes.STUDENT, SUBJECT, firstWeb), {
      replacedBy: CLIENT_KINDS.WEB,
    });
  });

  it('a second phone replaces the first and keeps the browser', async () => {
    const { sessions } = build();
    const browser = await openSession(sessions, 'r1', web);
    const firstPhone = await openSession(sessions, 'r2', mobile);
    await openSession(sessions, 'r3', mobile);

    assert.equal(await sessions.exists(ActorTypes.STUDENT, SUBJECT, firstPhone), false);
    assert.equal(await sessions.exists(ActorTypes.STUDENT, SUBJECT, browser), true);
  });

  it('a sign-in of either kind replaces a session from before kinds were kept', async () => {
    const { sessions } = build();
    const legacy = await openSession(sessions, 'r1', NO_DEVICE);
    await openSession(sessions, 'r2', mobile);

    assert.equal(await sessions.exists(ActorTypes.STUDENT, SUBJECT, legacy), false);
  });

  it('never replaces an admin session', async () => {
    const { sessions } = build();
    const first = await openSession(sessions, 'r1', web, ActorTypes.ADMIN);
    await openSession(sessions, 'r2', web, ActorTypes.ADMIN);

    assert.equal(await sessions.exists(ActorTypes.ADMIN, SUBJECT, first), true);
  });

  it('a session signed out on purpose leaves no replacement behind', async () => {
    const { sessions } = build();
    const id = await openSession(sessions, 'r1', web);
    await sessions.revoke(ActorTypes.STUDENT, SUBJECT, id);

    assert.equal(await sessions.replacedBy(ActorTypes.STUDENT, SUBJECT, id), null);
  });

  it('a replaced session refreshing is told it was replaced', async () => {
    const { sessions } = build();
    const first = await openSession(sessions, 'r1', web);
    await openSession(sessions, 'r2', web);

    await assert.rejects(
      () => sessions.rotate(ActorTypes.STUDENT, SUBJECT, first, 'r1', 'r1b', web, TTL),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.SESSION_REPLACED,
    );
  });
});
