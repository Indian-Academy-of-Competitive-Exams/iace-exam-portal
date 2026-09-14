import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { type ExecutionContext } from '@nestjs/common';
import { ActorTypes, ErrorCodes, FEATURE_KEYS, PERMISSION_LEVELS } from '@iace/contracts';
import { type AuthenticatedUser } from '../src/common/security';
import { FeaturePermissionGuard } from '../src/auth/guards/feature-permission.guard';
import { AdminOverviewController } from '../src/attempts/overview.controller';

describe('AdminOverviewController guard', () => {
  const guard = new FeaturePermissionGuard(new Reflector());

  function contextFor(user: Partial<AuthenticatedUser>): ExecutionContext {
    const request = {
      user: {
        id: 'adm_1',
        actor: ActorTypes.ADMIN,
        isActive: true,
        isSuperAdmin: false,
        allBranches: false,
        branchIds: ['brn_1'],
        permissions: {},
        ...user,
      },
    };

    return {
      getHandler: () => AdminOverviewController.prototype.read,
      getClass: () => AdminOverviewController,
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it('lets an admin holding STUDENT_PERFORMANCE through', () => {
    const context = contextFor({
      permissions: { [FEATURE_KEYS.STUDENT_PERFORMANCE]: PERMISSION_LEVELS.READ },
    });

    assert.equal(guard.canActivate(context), true);
  });

  /** Managing students is not the same as reading how one of them performs. */
  it('refuses an admin who holds every other key', () => {
    const context = contextFor({
      permissions: { [FEATURE_KEYS.STUDENT_MANAGEMENT]: PERMISSION_LEVELS.WRITE },
    });

    assert.throws(
      () => guard.canActivate(context),
      (error: { code?: string }) => error.code === ErrorCodes.FORBIDDEN,
    );
  });

  it('refuses a student token outright', () => {
    const context = contextFor({ actor: ActorTypes.STUDENT });

    assert.throws(
      () => guard.canActivate(context),
      (error: { code?: string }) => error.code === ErrorCodes.FORBIDDEN,
    );
  });
});
