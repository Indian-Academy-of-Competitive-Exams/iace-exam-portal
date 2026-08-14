import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FEATURE_KEYS,
  FEATURE_KEY_VALUES,
  PERMISSION_LEVELS,
  adminPermissionsSchema,
  createAdminSchema,
  createFeatureSchema,
  featureKeySchema,
  permissionLevelSchema,
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

  it('exposes exactly the four initial sectors', () => {
    assert.deepEqual(
      [...FEATURE_KEY_VALUES].sort(),
      [
        'BRANCH_TEST_MANAGEMENT',
        'QUESTION_MANAGEMENT',
        'STUDENT_MANAGEMENT',
        'TEST_MANAGEMENT',
      ].sort(),
    );
  });

  it('refuses a key outside the canonical list', () => {
    // A feature nothing gates is worse than no feature, so the key is a closed
    // enum rather than free text.
    assert.equal(featureKeySchema.safeParse('STUDENT_MANAGEMENT').success, true);
    assert.equal(featureKeySchema.safeParse('students.manage').success, false);
    assert.equal(featureKeySchema.safeParse('WHATEVER').success, false);
    assert.equal(permissionLevelSchema.safeParse('DELETE').success, false);
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

  it('rejects a feature whose key is not canonical', () => {
    assert.equal(createFeatureSchema.safeParse({ key: 'NOPE', name: 'Nope' }).success, false);
    assert.equal(
      createFeatureSchema.safeParse({ key: FEATURE_KEYS.TEST_MANAGEMENT, name: 'Tests' }).success,
      true,
    );
  });

  it('accepts a permissions map keyed only by canonical keys', () => {
    const ok = adminPermissionsSchema.safeParse({
      [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
    });
    assert.equal(ok.success, true);
    assert.equal(adminPermissionsSchema.safeParse({ NOT_A_KEY: 'READ' }).success, false);
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
