import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActorTypes, AppException, ErrorCodes } from '@iace/contracts';
import { OtpService } from '../src/auth/otp/otp.service';
import { FakeConfig, FakeMessageSender, FakeMetrics, FakeRedis } from './support/fakes';

const MOBILE = '9876543210';
const IP = '203.0.113.9';

function build(overrides = {}) {
  const redis = new FakeRedis();
  const config = new FakeConfig(overrides);
  const sender = new FakeMessageSender();
  const metrics = new FakeMetrics();
  return {
    redis,
    config,
    sender,
    metrics,
    otp: new OtpService(redis.asService(), config.asService(), sender, metrics.asService()),
  };
}

describe('OtpService — request', () => {
  it('sends a code of the configured length, zero-padded', async () => {
    const { otp, sender } = build();

    await otp.request(ActorTypes.STUDENT, MOBILE);

    assert.match(sender.lastCode, /^\d{6}$/);
  });

  it('tells the caller how many digits it sent, so the screen draws that many boxes', async () => {
    const { otp, sender } = build({ OTP_LENGTH: 4 });

    const challenge = await otp.request(ActorTypes.STUDENT, MOBILE);

    assert.equal(challenge.codeLength, 4);
    // The length of the code actually sent, not of the setting read twice — a padded code is what the student sees, and the boxes must match it.
    assert.equal(challenge.codeLength, sender.lastCode.length);
  });

  it('stores a hash, never the code itself, with no attempts counted yet', async () => {
    const { otp, redis, sender } = build();

    await otp.request(ActorTypes.STUDENT, MOBILE);

    const stored = redis.snapshot()[`otp:student:${MOBILE}`];
    assert.ok(typeof stored === 'string');
    assert.ok(!stored.includes(sender.lastCode));
    assert.equal(redis.snapshot()[`otp:attempts:student:${MOBILE}`], undefined);
  });

  it('echoes the code back only for the console sender in development', async () => {
    const dev = build();
    assert.equal((await dev.otp.request(ActorTypes.STUDENT, MOBILE)).devCode, dev.sender.lastCode);

    // A real deployment must never hand the code to the caller — that would make the SMS decorative and the endpoint an open door.
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
      (k) => k.startsWith('otp:') && !k.includes('cooldown') && !k.includes('daily'),
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

    // Gone — even the correct code no longer works. A million tries inside one TTL is otherwise enough for a 6-digit code.
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

  /** The failure this prevents: a read-modify-write counter that a wave of guesses advances once instead of once each. */
  it('makes each concurrent guess consume its own attempt, so a burst reaches the cap', async () => {
    const { otp, redis } = build();
    await otp.request(ActorTypes.STUDENT, MOBILE);

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () =>
        otp.verify(ActorTypes.STUDENT, MOBILE, '000000').then(
          () => 'accepted',
          (error: unknown) => (AppException.is(error) ? error.code : 'unknown'),
        ),
      ),
    );

    // OTP_MAX_VERIFY_ATTEMPTS defaults to 5: attempts 1-4 are still under it, 5-8 land past it.
    assert.equal(outcomes.filter((o) => o === 'OTP_INVALID').length, 4);
    assert.equal(outcomes.filter((o) => o === 'RATE_LIMITED').length, 4);
    assert.equal(redis.snapshot()[`otp:student:${MOBILE}`], undefined);
  });
});

describe('OtpService — the day a mobile is allowed', () => {
  const noCooldown = { OTP_RESEND_COOLDOWN_SEC: 0 };
  const refusedAsRateLimited = (error: unknown) =>
    AppException.is(error) && error.code === ErrorCodes.RATE_LIMITED;

  /** The failure this prevents: one phone bombed with codes, 45 seconds apart, on the platform's bill. */
  it('refuses a code past the day’s allowance, and sends nothing', async () => {
    const { otp, sender } = build(noCooldown);
    for (let sent = 0; sent < 5; sent += 1) await otp.request(ActorTypes.STUDENT, MOBILE);

    await assert.rejects(() => otp.request(ActorTypes.STUDENT, MOBILE), refusedAsRateLimited);
    assert.equal(sender.sent.length, 5);
  });

  it('lets the number be sent to again once the day has rolled past', async () => {
    const { otp, redis } = build(noCooldown);
    for (let sent = 0; sent < 5; sent += 1) await otp.request(ActorTypes.STUDENT, MOBILE);

    redis.advanceSeconds(24 * 60 * 60);

    assert.equal((await otp.request(ActorTypes.STUDENT, MOBILE)).sent, true);
  });

  /** The failure this prevents: a crash between INCR and EXPIRE leaves a counter that never resets, locking the number out forever. */
  it('repairs a daily counter a crash left with no TTL', async () => {
    const { otp, redis } = build(noCooldown);
    // As if the first request's INCR landed but its EXPIRE never did.
    await redis.client.set(`otp:daily:${MOBILE}`, '1');
    assert.equal(await redis.client.ttl(`otp:daily:${MOBILE}`), -1);

    await otp.request(ActorTypes.STUDENT, MOBILE);

    assert.ok((await redis.client.ttl(`otp:daily:${MOBILE}`)) > 0);
  });

  it('counts each mobile on its own', async () => {
    const { otp } = build(noCooldown);
    for (let sent = 0; sent < 5; sent += 1) await otp.request(ActorTypes.STUDENT, MOBILE);

    assert.equal((await otp.request(ActorTypes.STUDENT, '9123456780')).sent, true);
  });

  /** Admins sign in by email OTP every time, so a day's cap would lock them out of their own work. */
  it('never caps an admin', async () => {
    const { otp, sender } = build(noCooldown);
    for (let sent = 0; sent < 6; sent += 1) await otp.request(ActorTypes.ADMIN, 'admin@iace.co.in');

    assert.equal(sender.sent.length, 6);
  });
});

describe('OtpService — the day one address is allowed', () => {
  // A high per-mobile cap isolates the per-IP one; distinct mobiles rule out the per-mobile cap firing instead.
  const small = { OTP_MAX_PER_DAY: 1000, OTP_MAX_PER_DAY_PER_IP: 2, OTP_RESEND_COOLDOWN_SEC: 0 };
  const refusedAsRateLimited = (error: unknown) =>
    AppException.is(error) && error.code === ErrorCodes.RATE_LIMITED;

  /** The failure this prevents: SMS pumping, which mints a fresh number every request rather than reusing one. */
  it('refuses past one address’s daily allowance, whatever mobile it is sent to', async () => {
    const { otp } = build(small);
    await otp.request(ActorTypes.STUDENT, '9000000001', IP);
    await otp.request(ActorTypes.STUDENT, '9000000002', IP);

    await assert.rejects(
      () => otp.request(ActorTypes.STUDENT, '9000000003', IP),
      refusedAsRateLimited,
    );
  });

  it('does not count a different address against this one', async () => {
    const { otp } = build(small);
    await otp.request(ActorTypes.STUDENT, '9000000001', IP);
    await otp.request(ActorTypes.STUDENT, '9000000002', IP);

    assert.equal((await otp.request(ActorTypes.STUDENT, '9000000003', '198.51.100.7')).sent, true);
  });

  /** A branch's own lab session must still get through comfortably under the default budget. */
  it('lets a legitimate branch through under the default per-address budget', async () => {
    const { otp } = build({ OTP_RESEND_COOLDOWN_SEC: 0 });

    for (let i = 0; i < 20; i += 1) {
      const mobile = `90000${String(i).padStart(5, '0')}`;
      assert.equal((await otp.request(ActorTypes.STUDENT, mobile, IP)).sent, true);
    }
  });
});

describe("OtpService — the platform's daily budget", () => {
  const budgeted = {
    OTP_MAX_PER_DAY: 1000,
    OTP_MAX_PER_DAY_PER_IP: 1000,
    OTP_RESEND_COOLDOWN_SEC: 0,
    NOTIFICATION_COST_SMS_PAISE: 100,
    OTP_GLOBAL_DAILY_BUDGET_PAISE: 200,
  };

  /** The failure this prevents: many rotating addresses, each under its own cap, adding up to an unbounded bill. */
  it('trips the kill switch once today’s spend would cross the budget, and surfaces it', async () => {
    const { otp, metrics } = build(budgeted);
    await otp.request(ActorTypes.STUDENT, '9000000001', IP);
    await otp.request(ActorTypes.STUDENT, '9000000002', '198.51.100.7');

    await assert.rejects(
      () => otp.request(ActorTypes.STUDENT, '9000000003', '198.51.100.8'),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.RATE_LIMITED,
    );
    assert.deepEqual(metrics.otpSends, ['sent', 'sent', 'refused_budget']);
  });

  /** Admins cost nothing, so the razor-thin budget below must never reach them. */
  it('never trips for an admin', async () => {
    const { otp, sender } = build({ ...budgeted, OTP_GLOBAL_DAILY_BUDGET_PAISE: 1 });
    for (let i = 0; i < 3; i += 1) await otp.request(ActorTypes.ADMIN, `admin${i}@iace.co.in`);

    assert.equal(sender.sent.length, 3);
  });
});
