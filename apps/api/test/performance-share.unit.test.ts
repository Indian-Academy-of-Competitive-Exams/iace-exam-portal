import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { type Type } from '@nestjs/common';
import { ErrorCodes, FEATURE_KEYS, PERMISSION_LEVELS } from '@iace/contracts';
import { IS_PUBLIC_KEY, REQUIRED_FEATURE_KEY, type RequiredFeature } from '../src/common/security';
import {
  AdminPerformanceShareController,
  MePerformanceShareController,
  PublicReportController,
} from '../src/attempts/performance-share.controller';
import { newShareToken, shareExpiresAt, shareIsLive } from '../src/attempts/performance-share';

type Reflected = Type<unknown> | ((...args: never[]) => unknown);

// --------------------------------------------------------------------------- the token itself
// ---------------------------------------------------------------------------

describe('the share token', () => {
  /** The failure this prevents: a cuid, which is time-ordered, so one link hands you its neighbours. */
  it('is long, random and never repeats', () => {
    const minted = new Set(Array.from({ length: 2000 }, () => newShareToken()));

    assert.equal(minted.size, 2000);
    for (const token of minted) {
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    }
  });
});

describe('when a link runs out', () => {
  const now = new Date('2026-09-01T06:00:00.000Z');

  it('is live until it is revoked or its expiry passes', () => {
    assert.equal(shareIsLive({ revokedAt: null, expiresAt: null }, now), true);
    assert.equal(
      shareIsLive({ revokedAt: null, expiresAt: new Date('2026-09-30T00:00:00.000Z') }, now),
      true,
    );
    assert.equal(
      shareIsLive({ revokedAt: null, expiresAt: new Date('2026-08-30T00:00:00.000Z') }, now),
      false,
    );
    assert.equal(shareIsLive({ revokedAt: now, expiresAt: null }, now), false);
  });

  it('gives an unstated expiry thirty institute days, and keeps an explicit null permanent', () => {
    const defaulted = shareExpiresAt(undefined, now);
    const permanent = shareExpiresAt(null, now);
    const chosen = shareExpiresAt('2026-09-10', now);

    // Thirty institute days on from 1 Sep, expiring at the END of 1 Oct in Kolkata.
    assert.equal(defaulted?.toISOString(), '2026-10-01T18:29:59.999Z');
    assert.equal(permanent, null);
    assert.equal(chosen?.toISOString(), '2026-09-10T18:29:59.999Z');
  });

  /** The failure this prevents: minting a link that is dead the moment it is copied. */
  it('refuses an expiry that has already gone', () => {
    assert.throws(
      () => shareExpiresAt('2026-08-20', now),
      (error: { code?: string }) => error.code === ErrorCodes.VALIDATION_ERROR,
    );
  });
});

// --------------------------------------------------------------------------- who may knock
// ---------------------------------------------------------------------------

describe('the public opt-out', () => {
  const reflector = new Reflector();
  const isPublic = (handler: Reflected, target: Reflected) =>
    reflector.getAllAndOverride<boolean | undefined, string>(IS_PUBLIC_KEY, [handler, target]) ===
    true;

  /** The one route that must be reachable without a token. */
  it('opens the token read', () => {
    assert.equal(isPublic(PublicReportController.prototype.read, PublicReportController), true);
  });

  /** The failure this prevents: @Public() spreading from the read to something that writes. */
  it('leaves minting and revoking behind the guard, on both portals', () => {
    const guarded = [
      [MePerformanceShareController.prototype.list, MePerformanceShareController],
      [MePerformanceShareController.prototype.create, MePerformanceShareController],
      [MePerformanceShareController.prototype.revoke, MePerformanceShareController],
      [AdminPerformanceShareController.prototype.list, AdminPerformanceShareController],
      [AdminPerformanceShareController.prototype.create, AdminPerformanceShareController],
      [AdminPerformanceShareController.prototype.revoke, AdminPerformanceShareController],
    ] as const;

    for (const [handler, target] of guarded) {
      assert.equal(isPublic(handler, target), false);
    }
  });

  const demanded = (handler: Reflected) =>
    reflector.getAllAndOverride<RequiredFeature | undefined, string>(REQUIRED_FEATURE_KEY, [
      handler,
      AdminPerformanceShareController,
    ]);

  /** The failure this prevents: an admin route that any signed-in admin can reach for free. */
  it('charges every admin route STUDENT_PERFORMANCE, at the level the act deserves', () => {
    const priced = [
      [AdminPerformanceShareController.prototype.list, PERMISSION_LEVELS.READ],
      [AdminPerformanceShareController.prototype.create, PERMISSION_LEVELS.WRITE],
      [AdminPerformanceShareController.prototype.revoke, PERMISSION_LEVELS.WRITE],
    ] as const;

    for (const [handler, level] of priced) {
      assert.deepEqual(demanded(handler), { key: FEATURE_KEYS.STUDENT_PERFORMANCE, level });
    }
  });
});
