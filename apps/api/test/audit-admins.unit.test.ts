import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ADMIN_ROLES, AUDIT_FEATURE, fieldDiff } from '@iace/contracts';
import { AdminsController } from '../src/admins/admins.controller';
import { AUDITED_ADMIN_FIELDS } from '../src/admins/admins.service';
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

  /** Filed against the admin in the path. Reading the key list is not a change and is filed nowhere. */
  it('files the permissions save, and nothing for reading the list', () => {
    assert.equal(routeOf('setPermissions')?.feature, AUDIT_FEATURE.FEATURE_PERMISSION);
    assert.equal(routeOf('listFeatures'), undefined);
  });
});
