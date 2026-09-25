import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ADMIN_ROLES, AUDIT_FEATURE, fieldDiff } from '@iace/contracts';
import { AdminsController } from '../src/admins/admins.controller';
import { AUDITED_ADMIN_FIELDS, permissionDiff } from '../src/admins/admins.service';
import { AUDIT_KEY, type AuditRoute } from '../src/audit/audit.decorator';

describe('the admin audit diff', () => {
  it('covers what an admin edit can change', () => {
    assert.deepEqual([...AUDITED_ADMIN_FIELDS], ['fullName', 'role', 'isSuperAdmin']);
  });

  /** Promotion to super admin bypasses every feature check, so it is the row to find. */
  it('reports a promotion to super admin', () => {
    const before = { fullName: 'R Kumar', role: ADMIN_ROLES.ADMIN, isSuperAdmin: false };

    assert.deepEqual(fieldDiff(before, { ...before, isSuperAdmin: true }, AUDITED_ADMIN_FIELDS), {
      isSuperAdmin: { from: false, to: true },
    });
  });
});

describe('what files under FEATURE_PERMISSION', () => {
  const routeOf = (handler: keyof AdminsController) =>
    Reflect.getMetadata(AUDIT_KEY, AdminsController.prototype[handler]) as AuditRoute | undefined;

  /** `entityId` under FEATURE_PERMISSION is an Admin id, set deliberately by changeGrant. Reading the key list is not a change and is filed nowhere. */
  it('files the two grant routes, and nothing for reading the list', () => {
    assert.equal(routeOf('grant')?.feature, AUDIT_FEATURE.FEATURE_PERMISSION);
    assert.equal(routeOf('revoke')?.feature, AUDIT_FEATURE.FEATURE_PERMISSION);
    assert.equal(routeOf('listFeatures'), undefined);
  });
});

describe('permission grants', () => {
  it('records a grant as the level arriving', () => {
    assert.deepEqual(permissionDiff({ key: 'STUDENT_MANAGEMENT', level: 'WRITE' }), {
      STUDENT_MANAGEMENT: { from: null, to: 'WRITE' },
    });
  });

  it('records a revoke as the level going away', () => {
    assert.deepEqual(permissionDiff({ key: 'STUDENT_MANAGEMENT', level: 'WRITE' }, true), {
      STUDENT_MANAGEMENT: { from: 'WRITE', to: null },
    });
  });
});
