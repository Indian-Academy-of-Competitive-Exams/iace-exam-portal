import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException } from '@iace/contracts';
import { PinService } from '../src/auth/pin/pin.service';
import { FakeConfig, FakeRedis } from './support/fakes';

/**
 * The PIN is a 4-digit secret — 10,000 possibilities. What keeps it safe is the
 * pepper (offline) and the escalating lockout (online), so those are what these
 * assert, not just "hash then verify".
 */

const MOBILE = '9876543210';

function build(overrides = {}) {
  const redis = new FakeRedis();
  const config = new FakeConfig(overrides);
  return { redis, config, pin: new PinService(redis.asService(), config.asService()) };
}

describe('PinService — hashing', () => {
  it('verifies the right PIN and rejects the wrong one', async () => {
    const { pin } = build();
    const hash = await pin.hash('4813');

    assert.equal(await pin.verify(hash, '4813'), true);
    assert.equal(await pin.verify(hash, '4812'), false);
  });

  it('never stores the PIN itself', async () => {
    const { pin } = build();
    const hash = await pin.hash('4813');

    assert.ok(hash.startsWith('$argon2id$'));
    assert.ok(!hash.includes('4813'));
  });

  it('gives two students with the SAME PIN different hashes', async () => {
    const { pin } = build();

    // Per-hash salt. Without it, equal hashes would leak "these two share a PIN"
    // to anyone reading the table.
    assert.notEqual(await pin.hash('4813'), await pin.hash('4813'));
  });

  it('is useless without the pepper — the point of having one', async () => {
    const { pin } = build();
    const hash = await pin.hash('4813');

    // A stolen Student table, cracked with the wrong pepper, matches nothing.
    // 10,000 candidates is otherwise a fraction of a second's work.
    const { pin: attacker } = build({ PIN_PEPPER: 'a-different-pepper-000000000000000000' });
    assert.equal(await attacker.verify(hash, '4813'), false);
  });

  it('treats a malformed or foreign hash as a failed login, not a crash', async () => {
    const { pin } = build();

    assert.equal(await pin.verify('not-a-hash', '4813'), false);
    assert.equal(await pin.verify('', '4813'), false);
  });

  it('burns comparable time when there is no account, so timing says nothing', async () => {
    const { pin } = build();
    await assert.doesNotReject(() => pin.burnVerifyTime());
  });
});

describe('PinService — lockout', () => {
  it('does not lock before the cap', async () => {
    const { pin } = build();

    for (let i = 0; i < 4; i++) await pin.registerFailure(MOBILE);

    await assert.doesNotReject(() => pin.assertNotLocked(MOBILE));
  });

  it('locks on the Nth wrong PIN and reports how long is left', async () => {
    const { pin } = build();

    for (let i = 0; i < 5; i++) await pin.registerFailure(MOBILE);

    await assert.rejects(
      () => pin.assertNotLocked(MOBILE),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, 'PIN_LOCKED');
        assert.equal(error.httpStatus, 429);
        assert.deepEqual(error.details, { retryAfterSec: 900 });
        return true;
      },
    );
  });

  it('escalates when the lockout is waited out and the attack resumes', async () => {
    const { pin, redis } = build();
    const lockFor = async () => {
      for (let i = 0; i < 5; i++) await pin.registerFailure(MOBILE);
      return redis.ttl(`pin:lock:${MOBILE}`);
    };

    assert.equal(await lockFor(), 900);

    // Wait out the 15 minutes and start again — the case a flat cooldown loses.
    redis.advanceSeconds(901);
    assert.equal(await lockFor(), 3600);

    redis.advanceSeconds(3601);
    assert.equal(await lockFor(), 86400);
  });

  it('holds at the last rung instead of wrapping back to the first', async () => {
    const { pin, redis } = build();

    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 5; i++) await pin.registerFailure(MOBILE);
      redis.advanceSeconds(86401);
    }
    for (let i = 0; i < 5; i++) await pin.registerFailure(MOBILE);

    assert.equal(await redis.ttl(`pin:lock:${MOBILE}`), 86400);
  });

  it('keeps the rung counter alive longer than the lockout it caused', async () => {
    const { pin, redis } = build();

    for (let i = 0; i < 5; i++) await pin.registerFailure(MOBILE);

    // If the counter died with the lock, waiting one out would reset the ladder
    // — which is precisely the attack.
    assert.equal(await redis.ttl(`pin:lockouts:${MOBILE}`), 900 + 86400);
  });

  it('drops back to the first rung after a quiet spell', async () => {
    const { pin, redis } = build();

    for (let i = 0; i < 5; i++) await pin.registerFailure(MOBILE);
    redis.advanceSeconds(900 + 86400 + 1);
    for (let i = 0; i < 5; i++) await pin.registerFailure(MOBILE);

    assert.equal(await redis.ttl(`pin:lock:${MOBILE}`), 900);
  });

  it('ages isolated typos out instead of stacking them over days', async () => {
    const { pin, redis } = build();

    for (let i = 0; i < 4; i++) await pin.registerFailure(MOBILE);
    redis.advanceSeconds(901); // the attempt window has passed
    await pin.registerFailure(MOBILE);

    await assert.doesNotReject(() => pin.assertNotLocked(MOBILE));
  });

  it('clearFailures wipes the lock and the ladder, not just the counter', async () => {
    const { pin, redis } = build();

    for (let i = 0; i < 5; i++) await pin.registerFailure(MOBILE);
    await pin.clearFailures(MOBILE);

    await assert.doesNotReject(() => pin.assertNotLocked(MOBILE));
    assert.deepEqual(
      Object.keys(redis.snapshot()).filter((k) => k.startsWith('pin:')),
      [],
    );
  });
});

describe('PinService — setup ticket', () => {
  it('issues a ticket that can be redeemed exactly once', async () => {
    const { pin } = build();
    const { setupToken, expiresInSec } = await pin.issueSetupToken(MOBILE);

    assert.equal(expiresInSec, 600);
    await assert.doesNotReject(() => pin.consumeSetupToken(MOBILE, setupToken));

    // One OTP sets one PIN — a replay must not set a second.
    await assert.rejects(
      () => pin.consumeSetupToken(MOBILE, setupToken),
      (e: unknown) => AppException.is(e) && e.code === 'OTP_EXPIRED',
    );
  });

  it('rejects a forged ticket, and one belonging to another number', async () => {
    const { pin } = build();
    const { setupToken } = await pin.issueSetupToken(MOBILE);

    await assert.rejects(
      () => pin.consumeSetupToken(MOBILE, 'forged'),
      (e: unknown) => AppException.is(e) && e.code === 'OTP_EXPIRED',
    );
    await assert.rejects(
      () => pin.consumeSetupToken('9000000000', setupToken),
      (e: unknown) => AppException.is(e) && e.code === 'OTP_EXPIRED',
    );
  });

  it('stores only a digest of the ticket', async () => {
    const { pin, redis } = build();
    const { setupToken } = await pin.issueSetupToken(MOBILE);

    const stored = redis.snapshot()[`pin:setup:${MOBILE}`];
    assert.ok(stored);
    assert.notEqual(stored, setupToken);
  });

  it('expires with its TTL', async () => {
    const { pin, redis } = build();
    const { setupToken } = await pin.issueSetupToken(MOBILE);

    redis.advanceSeconds(601);

    await assert.rejects(
      () => pin.consumeSetupToken(MOBILE, setupToken),
      (e: unknown) => AppException.is(e) && e.code === 'OTP_EXPIRED',
    );
  });
});
