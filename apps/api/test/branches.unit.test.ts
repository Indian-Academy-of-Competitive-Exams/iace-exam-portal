import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActorTypes, AppException, ErrorCodes, createBranchSchema } from '@iace/contracts';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { branchDeletionBlocker, branchEditBlocker } from '../src/branches/branch-rules';
import { SuperAdminGuard } from '../src/auth/guards/super-admin.guard';
import { SUPER_ADMIN_KEY } from '../src/common/security';

describe('branchDeletionBlocker', () => {
  it('allows deleting an empty branch', () => {
    assert.equal(branchDeletionBlocker({ groupCount: 0, isGlobal: false }), null);
  });

  /**
   * The failure this exists to prevent: a branch is tidied away, its groups go
   * with it, and every student in them silently loses the route to their tests.
   */
  it('refuses a branch that still has groups, and says how many', () => {
    const blocker = branchDeletionBlocker({ groupCount: 3, isGlobal: false });
    assert.match(blocker ?? '', /still has 3 groups/);
  });

  it('reads naturally for a single group', () => {
    assert.match(branchDeletionBlocker({ groupCount: 1, isGlobal: false }) ?? '', /1 group\b/);
  });

  it('refuses GLOBAL even when it is empty — nothing would re-create it', () => {
    assert.match(branchDeletionBlocker({ groupCount: 0, isGlobal: true }) ?? '', /GLOBAL/);
  });
});

describe('branchEditBlocker', () => {
  it('leaves an ordinary branch alone', () => {
    assert.equal(branchEditBlocker({ isGlobal: false }, { name: 'KUKATPALLY' }), null);
    assert.equal(branchEditBlocker({ isGlobal: false }, { isActive: false }), null);
  });

  it('refuses to rename GLOBAL', () => {
    assert.match(branchEditBlocker({ isGlobal: true }, { name: 'EVERYONE' }) ?? '', /renamed/);
  });

  it('refuses to deactivate GLOBAL', () => {
    assert.match(branchEditBlocker({ isGlobal: true }, { isActive: false }) ?? '', /deactivated/);
  });

  it('still permits a no-op patch on GLOBAL', () => {
    assert.equal(branchEditBlocker({ isGlobal: true }, {}), null);
    assert.equal(branchEditBlocker({ isGlobal: true }, { isActive: true }), null);
  });
});

describe('createBranchSchema', () => {
  it('normalises the name on the way in', () => {
    assert.deepEqual(createBranchSchema.parse({ name: ' rtc  x roads ' }), { name: 'RTC X ROADS' });
  });

  it('refuses a name that cannot be tidied into the canonical form', () => {
    assert.equal(createBranchSchema.safeParse({ name: 'RTC-X-ROADS' }).success, false);
  });
});

// ============================================================================

/**
 * A page permission must not become a way to invent a branch. `groups.manage`
 * is grantable; the branch list every group is created against is not.
 */
describe('SuperAdminGuard', () => {
  const guardFor = (required: boolean | undefined, user: unknown) => {
    const reflector = {
      getAllAndOverride: (key: string) => (key === SUPER_ADMIN_KEY ? required : undefined),
    } as unknown as Reflector;

    const context = {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;

    return () => new SuperAdminGuard(reflector).canActivate(context);
  };

  const superAdmin = { actor: ActorTypes.ADMIN, isSuperAdmin: true };
  const plainAdmin = { actor: ActorTypes.ADMIN, isSuperAdmin: false };
  const student = { actor: ActorTypes.STUDENT, isSuperAdmin: false };

  it('lets a super admin through', () => {
    assert.equal(guardFor(true, superAdmin)(), true);
  });

  it('refuses an admin who is not a super admin, however many pages they hold', () => {
    assert.throws(guardFor(true, plainAdmin), (error: unknown) => {
      assert.ok(AppException.is(error));
      assert.equal(error.code, ErrorCodes.FORBIDDEN);
      return true;
    });
  });

  it('refuses a student', () => {
    assert.throws(guardFor(true, student), (error: unknown) => {
      assert.ok(AppException.is(error));
      assert.equal(error.code, ErrorCodes.FORBIDDEN);
      return true;
    });
  });

  it('refuses an unauthenticated request', () => {
    assert.throws(guardFor(true, undefined), (error: unknown) => {
      assert.ok(AppException.is(error));
      assert.equal(error.code, ErrorCodes.FORBIDDEN);
      return true;
    });
  });

  it('does not gate routes that never asked to be gated', () => {
    assert.equal(guardFor(undefined, plainAdmin)(), true);
  });
});
