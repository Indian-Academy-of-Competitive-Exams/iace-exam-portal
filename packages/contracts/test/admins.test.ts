import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  adminPermissionsSchema,
  createAdminSchema,
  createFeatureSchema,
  featureKeySchema,
  permissionLevelSchema,
  canonicalFeatureKey,
  satisfiesLevel,
  ADMIN_FEATURE_ROUTES,
} from '../src/admins';

/**
 * The guard and the admin app both answer "may this admin do X" and they must
 * answer identically. If they ever disagree the symptom is a button that is
 * visible and then refused, which reads to the user as a broken product rather
 * than a permissions decision. So the rule is one shared function, tested here.
 */
describe('satisfiesLevel', () => {
  it('lets WRITE satisfy READ, because seeing is implied by changing', () => {
    assert.equal(satisfiesLevel(PERMISSION_LEVELS.WRITE, PERMISSION_LEVELS.READ), true);
  });

  it('does not let READ satisfy WRITE', () => {
    assert.equal(satisfiesLevel(PERMISSION_LEVELS.READ, PERMISSION_LEVELS.WRITE), false);
  });

  it('matches a level against itself', () => {
    assert.equal(satisfiesLevel(PERMISSION_LEVELS.READ, PERMISSION_LEVELS.READ), true);
    assert.equal(satisfiesLevel(PERMISSION_LEVELS.WRITE, PERMISSION_LEVELS.WRITE), true);
  });

  it('refuses everything when nothing is granted', () => {
    // The failure this exists to prevent: an ungranted admin must not fall
    // through to allowed. Absent is not empty-and-therefore-permissive.
    assert.equal(satisfiesLevel(undefined, PERMISSION_LEVELS.READ), false);
    assert.equal(satisfiesLevel(undefined, PERMISSION_LEVELS.WRITE), false);
  });
});

describe('shared vocabularies', () => {
  it('keeps every key and level SCREAMING_SNAKE_CASE and self-valued', () => {
    // Prisma mirrors these values exactly, so a lowercase slip here is a
    // migration that does not match the enum it is supposed to mirror.
    for (const [name, value] of Object.entries({ ...FEATURE_KEYS, ...PERMISSION_LEVELS })) {
      assert.match(value, /^[A-Z][A-Z_]*$/, `${name} must be SCREAMING_SNAKE_CASE`);
      assert.equal(name, value, `${name} must equal its own value`);
    }
  });

  it('names the sectors code already references', () => {
    assert.deepEqual(
      Object.values(FEATURE_KEYS).sort(),
      [
        'BRANCH_TEST_MANAGEMENT',
        'QUESTION_MANAGEMENT',
        'STUDENT_MANAGEMENT',
        'TEST_MANAGEMENT',
      ].sort(),
    );
  });

  it('accepts any canonical key, because the set is open at runtime', () => {
    // A closed enum would make the API reject rows it had itself just created,
    // which surfaces on the client as "unexpected response shape".
    assert.equal(featureKeySchema.parse('STUDENT_MANAGEMENT'), 'STUDENT_MANAGEMENT');
    assert.equal(featureKeySchema.parse('REPORTING_DASHBOARD'), 'REPORTING_DASHBOARD');
    assert.equal(permissionLevelSchema.safeParse('DELETE').success, false);
  });

  it('normalises a key rather than rejecting it, so one sector has one spelling', () => {
    assert.equal(featureKeySchema.parse('student management'), 'STUDENT_MANAGEMENT');
    assert.equal(featureKeySchema.parse('  Question-Management '), 'QUESTION_MANAGEMENT');
    assert.equal(canonicalFeatureKey('a b  c'), 'A_B_C');
  });

  it('still refuses a key that normalises to nothing usable', () => {
    assert.equal(featureKeySchema.safeParse('').success, false);
    assert.equal(featureKeySchema.safeParse('!!').success, false);
    assert.equal(featureKeySchema.safeParse('9'.repeat(80)).success, false);
  });
});

describe('admin input schemas', () => {
  it('lowercases and trims an email, so case cannot fork an account', () => {
    const parsed = createAdminSchema.parse({ email: '  Dev@IACE.co.in ' });
    assert.equal(parsed.email, 'dev@iace.co.in');
    assert.equal(parsed.isSuperAdmin, false);
  });

  it('defaults isSuperAdmin to false rather than inheriting anything', () => {
    assert.equal(createAdminSchema.parse({ email: 'a@b.co' }).isSuperAdmin, false);
    assert.equal(
      createAdminSchema.parse({ email: 'a@b.co', isSuperAdmin: true }).isSuperAdmin,
      true,
    );
  });

  it('takes the key as the whole identity of a feature — there is no separate name', () => {
    const parsed = createFeatureSchema.parse({ key: 'reporting dashboard' });
    assert.equal(parsed.key, 'REPORTING_DASHBOARD');
    assert.equal('name' in parsed, false);
  });

  it('carries a grant on a key the code has never heard of', () => {
    // Dropping it would silently discard a grant a super admin deliberately
    // made — and discard it again on every refresh, so it would never stick.
    assert.equal(
      adminPermissionsSchema.safeParse({
        [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
        REPORTING_DASHBOARD: PERMISSION_LEVELS.READ,
      }).success,
      true,
    );
    assert.equal(adminPermissionsSchema.safeParse({}).success, true);
    // The LEVEL is still closed — that one really is a fixed vocabulary.
    assert.equal(adminPermissionsSchema.safeParse({ ANY_KEY: 'DELETE' }).success, false);
  });
});

describe('routes', () => {
  it('puts the revoke tuple in the path, never a DELETE body', () => {
    // A dropped DELETE body would make revoke a silent no-op, which is the one
    // failure mode this endpoint must not have.
    assert.equal(
      ADMIN_FEATURE_ROUTES.revoke(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE, 'adm_1'),
      '/admin/features/TEST_MANAGEMENT/permissions/WRITE/adm_1',
    );
  });
});
