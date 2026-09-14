import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ActorTypes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  type AdminPermissions,
  type FeatureKey,
} from '@iace/contracts';
import { bandsFor } from '../src/dashboard/dashboard-bands';
import { type AuthenticatedUser } from '../src/common/security';

function admin(over: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'adm_1',
    actor: ActorTypes.ADMIN,
    sessionId: 'ses_1',
    isSuperAdmin: false,
    isActive: true,
    permissions: {},
    ...over,
  };
}

const holding = (...keys: FeatureKey[]): AuthenticatedUser =>
  admin({
    permissions: Object.fromEntries(
      keys.map((key) => [key, PERMISSION_LEVELS.READ]),
    ) as AdminPermissions,
  });

describe('bandsFor — which bands a caller may see', () => {
  it('opens every band to a super admin', () => {
    const bands = bandsFor(admin({ isSuperAdmin: true }));

    assert.deepEqual(bands, {
      students: true,
      catalog: true,
      questions: true,
      tests: true,
      bank: true,
      sittings: true,
      feed: true,
      windows: true,
    });
  });

  it('closes every band to a deactivated super admin', () => {
    // isActive before the bypass, the guard's own order: nothing else can switch this account off.
    const bands = bandsFor(admin({ isSuperAdmin: true, isActive: false }));

    assert.equal(Object.values(bands).some(Boolean), false);
  });

  it('gives a typist the bank and nothing operational', () => {
    const bands = bandsFor(holding(FEATURE_KEYS.QUESTION_AUTHORING));

    assert.equal(bands.bank, true);
    assert.equal(bands.questions, true);
    assert.equal(bands.students, false);
    assert.equal(bands.tests, false);
    assert.equal(bands.windows, false);
    assert.equal(bands.sittings, false);
  });

  it('gives a student manager the roster and the catalog only', () => {
    const bands = bandsFor(holding(FEATURE_KEYS.STUDENT_MANAGEMENT));

    assert.equal(bands.students, true);
    assert.equal(bands.catalog, true);
    assert.equal(bands.bank, false);
    assert.equal(bands.windows, false);
  });

  it('opens windows to either key that owns a schedule', () => {
    assert.equal(bandsFor(holding(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT)).windows, true);
    assert.equal(bandsFor(holding(FEATURE_KEYS.TEST_MANAGEMENT)).windows, true);
  });

  it('opens the sittings series to either key that watches a sitting', () => {
    assert.equal(bandsFor(holding(FEATURE_KEYS.STUDENT_PERFORMANCE)).sittings, true);
    assert.equal(bandsFor(holding(FEATURE_KEYS.TEST_OPERATIONS)).sittings, true);
    assert.equal(bandsFor(holding(FEATURE_KEYS.TEST_MANAGEMENT)).sittings, false);
  });

  it('leaves the audit feed to every admin who is still active', () => {
    assert.equal(bandsFor(admin()).feed, true);
    assert.equal(bandsFor(admin({ isActive: false })).feed, false);
  });
});
