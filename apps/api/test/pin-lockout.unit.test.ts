import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lockoutDurationFor } from '../src/auth/pin/pin.service';
import { secondsToHuman } from '../src/common/duration';
import { validateEnv } from '../src/config/env.schema';

const DEFAULT_LADDER = [900, 3600, 86400];

describe('lockoutDurationFor', () => {
  it('climbs one rung per repeat lockout', () => {
    assert.equal(lockoutDurationFor(DEFAULT_LADDER, 1), 900);
    assert.equal(lockoutDurationFor(DEFAULT_LADDER, 2), 3600);
    assert.equal(lockoutDurationFor(DEFAULT_LADDER, 3), 86400);
  });

  it('stays on the last rung forever once the ladder runs out', () => {
    // The attacker must not get a shorter lockout by simply persisting.
    for (const count of [4, 5, 50, 1000]) {
      assert.equal(lockoutDurationFor(DEFAULT_LADDER, count), 86400);
    }
  });

  it('never returns less than the first rung, whatever the count', () => {
    // Defensive: a 0 or negative count must not fall off the front of the
    // ladder into a zero-length lockout.
    assert.equal(lockoutDurationFor(DEFAULT_LADDER, 0), 900);
    assert.equal(lockoutDurationFor(DEFAULT_LADDER, -3), 900);
  });

  it('works for a single-rung ladder (escalation switched off)', () => {
    assert.equal(lockoutDurationFor([600], 1), 600);
    assert.equal(lockoutDurationFor([600], 9), 600);
  });
});

describe('PIN_LOCKOUT_STEPS_SEC validation', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    REDIS_URL: 'redis://x',
    JWT_ACCESS_SECRET: 'x'.repeat(24),
    JWT_REFRESH_SECRET: 'y'.repeat(24),
    PIN_PEPPER: 'z'.repeat(24),
    S3_BUCKET: 'b',
    S3_ACCESS_KEY_ID: 'k',
    S3_SECRET_ACCESS_KEY: 's',
  };

  it('parses a comma-separated ladder', () => {
    const env = validateEnv({ ...base, PIN_LOCKOUT_STEPS_SEC: '900, 3600, 86400' });
    assert.deepEqual(env.PIN_LOCKOUT_STEPS_SEC, DEFAULT_LADDER);
  });

  it('defaults to 15 minutes → 1 hour → 1 day', () => {
    assert.deepEqual(validateEnv(base).PIN_LOCKOUT_STEPS_SEC, DEFAULT_LADDER);
  });

  it('refuses a ladder that gets SHORTER — that would weaken the lockout', () => {
    assert.throws(
      () => validateEnv({ ...base, PIN_LOCKOUT_STEPS_SEC: '3600,900' }),
      /must not decrease/,
    );
  });

  it('refuses junk and empty ladders at boot, not at the first lockout', () => {
    assert.throws(() => validateEnv({ ...base, PIN_LOCKOUT_STEPS_SEC: '900,abc' }), /positive/);
    assert.throws(() => validateEnv({ ...base, PIN_LOCKOUT_STEPS_SEC: '0' }), /positive/);
    assert.throws(() => validateEnv({ ...base, PIN_LOCKOUT_STEPS_SEC: '-60' }), /positive/);
  });
});

describe('secondsToHuman', () => {
  it('reads as a policy, not as a bug', () => {
    // The whole reason this exists: "1440 minute(s)" for a day-long lockout.
    assert.equal(secondsToHuman(900), '15 minutes');
    assert.equal(secondsToHuman(3600), '1 hour');
    assert.equal(secondsToHuman(86400), '1 day');
  });

  it('rounds a part-elapsed lockout up, never down to zero', () => {
    assert.equal(secondsToHuman(842), '15 minutes');
    assert.equal(secondsToHuman(61), '2 minutes');
    assert.equal(secondsToHuman(1), '1 second');
  });

  it('pluralises', () => {
    assert.equal(secondsToHuman(7200), '2 hours');
    assert.equal(secondsToHuman(172800), '2 days');
    assert.equal(secondsToHuman(120), '2 minutes');
  });
});
