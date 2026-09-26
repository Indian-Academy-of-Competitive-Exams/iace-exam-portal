import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { type ExecutionContext } from '@nestjs/common';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  type AdminPermissions,
} from '@iace/contracts';
import { FeaturePermissionGuard } from '../src/auth/guards/feature-permission.guard';
import { AuditController } from '../src/audit/audit.controller';
import { RequiresExport, type AuthenticatedUser } from '../src/common/security';

class ExportProbe {
  @RequiresExport(FEATURE_KEYS.TEST_MANAGEMENT)
  testReport() {}

  @RequiresExport()
  auditLog() {}
}

const guard = new FeaturePermissionGuard(new Reflector());

function canExport(
  handler: (...args: never[]) => unknown,
  permissions: AdminPermissions,
  { isSuperAdmin = false, isActive = true, owner = ExportProbe as object } = {},
): boolean {
  const user: AuthenticatedUser = {
    id: 'adm',
    actor: ActorTypes.ADMIN,
    sessionId: 's',
    isSuperAdmin,
    isActive,
    permissions,
  };
  const context = {
    getHandler: () => handler,
    getClass: () => owner,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  return guard.canActivate(context);
}

const forbidden = (error: unknown) => AppException.is(error) && error.code === ErrorCodes.FORBIDDEN;

const OWNING = { [FEATURE_KEYS.TEST_MANAGEMENT]: PERMISSION_LEVELS.READ };
const EXPORTS = { [FEATURE_KEYS.DATA_EXPORT]: PERMISSION_LEVELS.READ };

describe('RequiresExport with an owning feature', () => {
  const route = ExportProbe.prototype.testReport;

  it('passes an admin holding the owning READ and DATA_EXPORT', () => {
    assert.equal(canExport(route, { ...OWNING, ...EXPORTS }), true);
  });

  it('refuses the owning feature alone', () => {
    assert.throws(() => canExport(route, OWNING), forbidden);
  });

  it('refuses DATA_EXPORT alone', () => {
    assert.throws(() => canExport(route, EXPORTS), forbidden);
  });

  it('passes a super admin with no grants', () => {
    assert.equal(canExport(route, {}, { isSuperAdmin: true }), true);
  });

  it('refuses a deactivated admin holding both', () => {
    assert.throws(
      () => canExport(route, { ...OWNING, ...EXPORTS }, { isActive: false }),
      forbidden,
    );
  });
});

describe('RequiresExport without an owning feature', () => {
  const route = ExportProbe.prototype.auditLog;

  it('passes on DATA_EXPORT alone', () => {
    assert.equal(canExport(route, EXPORTS), true);
  });

  it('refuses without DATA_EXPORT', () => {
    assert.throws(() => canExport(route, OWNING), forbidden);
  });
});

/** The real route on its real class, so the metadata read is the one production reads. */
describe('The audit log export', () => {
  const route = AuditController.prototype.exportRowActions;
  const owner = AuditController;

  it('refuses an admin without DATA_EXPORT', () => {
    assert.throws(() => canExport(route, OWNING, { owner }), forbidden);
  });

  it('passes on DATA_EXPORT alone', () => {
    assert.equal(canExport(route, EXPORTS, { owner }), true);
  });
});
