import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActorTypes, AppException } from '@iace/contracts';
import { OtpService } from '../src/auth/otp/otp.service';
import { FakeConfig, FakeMessageSender, FakeRedis } from './support/fakes';

const MOBILE = '9876543210';

function build(overrides = {}) {
  const redis = new FakeRedis();
  const config = new FakeConfig(overrides);
  const sender = new FakeMessageSender();
  return {
    redis,
    config,
    sender,
    otp: new OtpService(redis.asService(), config.asService(), sender),
  };
}

describe('OtpService — request', () => {
  it('sends a code of the configured length, zero-padded', async () => {
    const { otp, sender } = build();

    await otp.request(ActorTypes.STUDENT, MOBILE);

    assert.match(sender.lastCode, /^\d{6}$/);
  });

  it('stores a hash, never the code itself', async () => {
    const { otp, redis, sender } = build();

    await otp.request(ActorTypes.STUDENT, MOBILE);

    const stored = redis.snapshot()[`otp:student:${MOBILE}`];
    assert.ok(typeof stored === 'string');
    assert.ok(!stored.includes(sender.lastCode));
    assert.equal(JSON.parse(stored).attempts, 0);
  });

  it('echoes the code back only for the console sender in development', async () => {
    const dev = build();
    assert.equal((await dev.otp.request(ActorTypes.STUDENT, MOBILE)).devCode, dev.sender.lastCode);

    // A real deployment must never hand the code to the caller — that would
    // make the SMS decorative and the endpoint an open door.
    const prod = build({ NODE_ENV: 'production' });
    assert.equal((await prod.otp.request(ActorTypes.STUDENT, MOBILE)).devCode, undefined);
  });

  it('refuses a resend inside the cooldown, and says how long is left', async () => {
    const { otp } = build();
    await otp.request(ActorTypes.STUDENT, MOBILE);

    await assert.rejects(
      () => otp.request(ActorTypes.STUDENT, MOBILE),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, 'RATE_LIMITED');
        assert.equal(error.httpStatus, 429);
        assert.deepEqual(error.details, { retryAfterSec: 45 });
        return true;
      },
    );
  });

  it('allows a resend once the cooldown has passed', async () => {
    const { otp, redis } = build();
    await otp.request(ActorTypes.STUDENT, MOBILE);
    redis.advanceSeconds(46);

    await assert.doesNotReject(() => otp.request(ActorTypes.STUDENT, MOBILE));
  });

  it('keeps students and admins in separate keyspaces', async () => {
    const { otp, redis } = build();

    await otp.request(ActorTypes.STUDENT, 'same-identifier');
    await otp.request(ActorTypes.ADMIN, 'same-identifier');

    const keys = Object.keys(redis.snapshot()).filter(
      (k) => k.startsWith('otp:') && !k.includes('cooldown'),
    );
    assert.deepEqual(keys.sort(), ['otp:admin:same-identifier', 'otp:student:same-identifier']);
  });
});

describe('OtpService — verify', () => {
  it('accepts the right code and consumes it', async () => {
    const { otp, sender, redis } = build();
    await otp.request(ActorTypes.STUDENT, MOBILE);

    await assert.doesNotReject(() => otp.verify(ActorTypes.STUDENT, MOBILE, sender.lastCode));

    // Single use: a verified code is gone, so it cannot be replayed.
    assert.equal(redis.snapshot()[`otp:student:${MOBILE}`], undefined);
    await assert.rejects(
      () => otp.verify(ActorTypes.STUDENT, MOBILE, sender.lastCode),
      (e: unknown) => AppException.is(e) && e.code === 'OTP_EXPIRED',
    );
  });

  it('clears the cooldown on success, so a next code is immediate', async () => {
    const { otp, sender, redis } = build();
    await otp.request(ActorTypes.STUDENT, MOBILE);
    await otp.verify(ActorTypes.STUDENT, MOBILE, sender.lastCode);

    assert.equal(redis.snapshot()[`otp:cooldown:student:${MOBILE}`], undefined);
  });

  it('rejects a wrong code with a field error and the attempts left', async () => {
    const { otp } = build();
    await otp.request(ActorTypes.STUDENT, MOBILE);

    await assert.rejects(
      () => otp.verify(ActorTypes.STUDENT, MOBILE, '000000'),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, 'OTP_INVALID');
        assert.deepEqual(error.fieldErrors, { code: ['Incorrect code'] });
        assert.deepEqual(error.details, { attemptsRemaining: 4 });
        return true;
      },
    );
  });

  it('burns the challenge after the attempt cap, so it cannot be brute-forced', async () => {
    const { otp, redis, sender } = build();
    await otp.request(ActorTypes.STUDENT, MOBILE);

    for (let i = 0; i < 4; i++) {
      await assert.rejects(() => otp.verify(ActorTypes.STUDENT, MOBILE, '000000'));
    }
    await assert.rejects(
      () => otp.verify(ActorTypes.STUDENT, MOBILE, '000000'),
      (e: unknown) => AppException.is(e) && e.code === 'RATE_LIMITED',
    );

    // Gone — even the correct code no longer works. A million tries inside one
    // TTL is otherwise enough for a 6-digit code.
    assert.equal(redis.snapshot()[`otp:student:${MOBILE}`], undefined);
    await assert.rejects(
      () => otp.verify(ActorTypes.STUDENT, MOBILE, sender.lastCode),
      (e: unknown) => AppException.is(e) && e.code === 'OTP_EXPIRED',
    );
  });

  it('reports an expired code as expired, not as wrong', async () => {
    const { otp, sender, redis } = build();
    await otp.request(ActorTypes.STUDENT, MOBILE);
    redis.advanceSeconds(301);

    await assert.rejects(
      () => otp.verify(ActorTypes.STUDENT, MOBILE, sender.lastCode),
      (e: unknown) => AppException.is(e) && e.code === 'OTP_EXPIRED',
    );
  });

  it('does not let a wrong attempt extend the code past its original TTL', async () => {
    const { otp, redis } = build();
    await otp.request(ActorTypes.STUDENT, MOBILE);
    redis.advanceSeconds(200);

    await assert.rejects(() => otp.verify(ActorTypes.STUDENT, MOBILE, '000000'));

    // ~100s left, not a fresh 300 — otherwise guessing would renew the window.
    const ttl = await redis.ttl(`otp:student:${MOBILE}`);
    assert.ok(ttl > 0, `the key should still exist, got ttl ${ttl}`);
    assert.ok(ttl <= 100, `expected <=100s left, got ${ttl}`);
  });
});
