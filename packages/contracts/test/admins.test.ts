import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADMIN_ROLES,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  ROLE_PERMISSION_PRESET,
  adminPermissionsSchema,
  createAdminSchema,
  featureKeySchema,
  permissionLevelSchema,
  satisfiesLevel,
  FEATURES,
  ADMIN_FEATURE_ROUTES,
} from '../src/admins';

/** The guard and the UI must answer identically, or a visible button gets refused. */
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
    // Regression guard: an ungranted admin must not fall through to allowed — absent is not empty-and-therefore-permissive.
    assert.equal(satisfiesLevel(undefined, PERMISSION_LEVELS.READ), false);
    assert.equal(satisfiesLevel(undefined, PERMISSION_LEVELS.WRITE), false);
  });
});

describe('shared vocabularies', () => {
  it('keeps every key and level SCREAMING_SNAKE_CASE and self-valued', () => {
    // Prisma mirrors these values exactly, so a lowercase slip here is a migration that doesn't match the enum it mirrors.
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
        'NOTIFICATION_MANAGEMENT',
        'QUESTION_AUTHORING',
        'QUESTION_MANAGEMENT',
        'QUESTION_PROOFREAD',
        'STUDENT_MANAGEMENT',
        'STUDENT_PERFORMANCE',
        'TEST_MANAGEMENT',
        'TEST_OPERATIONS',
      ].sort(),
    );
  });

  /** Regression guard: a closed key set prevents granting a key nothing in the code checks, which would read as access to a feature no guard ever consults. */
  it('accepts only the keys the code defines', () => {
    assert.equal(featureKeySchema.parse('STUDENT_MANAGEMENT'), 'STUDENT_MANAGEMENT');
    assert.equal(featureKeySchema.safeParse('REPORTING_DASHBOARD').success, false);
    assert.equal(featureKeySchema.safeParse('').success, false);
    assert.equal(permissionLevelSchema.safeParse('DELETE').success, false);
  });

  it('describes every key it defines, so the permissions screen never shows a bare constant', () => {
    for (const key of Object.values(FEATURE_KEYS)) {
      assert.ok(FEATURES[key]?.label, `${key} needs a label`);
      assert.ok(FEATURES[key]?.description, `${key} needs a description`);
    }
  });
});

describe('admin input schemas', () => {
  it('lowercases and trims an email, so case cannot fork an account', () => {
    const parsed = createAdminSchema.parse({ email: '  Dev@IACE.co.in ' });
    assert.equal(parsed.email, 'dev@iace.co.in');
  });

  /** The role is the only thing asked: the bypass is read off it, never sent beside it. */
  it('takes no super-admin flag of its own', () => {
    const parsed = createAdminSchema.parse({ email: 'a@b.co', isSuperAdmin: true });
    assert.equal('isSuperAdmin' in parsed, false);
    assert.equal(parsed.role, ADMIN_ROLES.ADMIN);
  });

  it('opens every role with the permissions that role is for', () => {
    assert.equal(
      ROLE_PERMISSION_PRESET[ADMIN_ROLES.TYPIST][FEATURE_KEYS.QUESTION_AUTHORING],
      PERMISSION_LEVELS.WRITE,
    );
    // A super admin is past every check a grant is read at, so it opens with none.
    assert.deepEqual(ROLE_PERMISSION_PRESET[ADMIN_ROLES.SUPER_ADMIN], {});
  });

  it('carries a partial grant map, and refuses a key or a level it does not define', () => {
    assert.equal(
      adminPermissionsSchema.safeParse({
        [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE,
      }).success,
      true,
    );
    // Absent means no access, so an empty map is a real answer.
    assert.equal(adminPermissionsSchema.safeParse({}).success, true);
    assert.equal(
      adminPermissionsSchema.safeParse({ [FEATURE_KEYS.TEST_MANAGEMENT]: 'DELETE' }).success,
      false,
    );
  });
});

describe('routes', () => {
  it('puts the revoke tuple in the path, never a DELETE body', () => {
    // A dropped DELETE body would make revoke a silent no-op, the one failure mode this endpoint must not have.
    assert.equal(
      ADMIN_FEATURE_ROUTES.revoke(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE, 'adm_1'),
      '/admin/features/TEST_MANAGEMENT/permissions/WRITE/adm_1',
    );
  });
});
