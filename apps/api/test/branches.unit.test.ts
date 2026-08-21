import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ActorTypes,
  AppException,
  BRANCH_TYPE,
  ErrorCodes,
  STUDENT_TYPE,
  createBranchSchema,
} from '@iace/contracts';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import {
  branchDeletionBlocker,
  branchEditBlocker,
  studentBranchBlocker,
} from '../src/branches/branch-rules';
import { SuperAdminGuard } from '../src/auth/guards/super-admin.guard';
import { SUPER_ADMIN_KEY } from '../src/common/security';

describe('branchDeletionBlocker', () => {
  it('allows deleting an empty branch', () => {
    assert.equal(branchDeletionBlocker({ studentCount: 0, type: BRANCH_TYPE.PHYSICAL }), null);
  });

  /**
   * The failure this exists to prevent: a branch is tidied away and every student who attends it
   * silently loses the centre their scheduling reads.
   */
  it('refuses a branch that still has students, and says how many', () => {
    const blocker = branchDeletionBlocker({ studentCount: 3, type: BRANCH_TYPE.PHYSICAL });
    assert.match(blocker ?? '', /still has 3 students/);
  });

  it('reads naturally for a single student', () => {
    assert.match(
      branchDeletionBlocker({ studentCount: 1, type: BRANCH_TYPE.PHYSICAL }) ?? '',
      /1 student\b/,
    );
  });

  it('refuses the online branch even when empty — nothing would re-create it', () => {
    assert.match(
      branchDeletionBlocker({ studentCount: 0, type: BRANCH_TYPE.VIRTUAL }) ?? '',
      /online branch/,
    );
  });
});

describe('branchEditBlocker', () => {
  it('leaves an ordinary branch alone', () => {
    assert.equal(branchEditBlocker({ type: BRANCH_TYPE.PHYSICAL }, { name: 'KUKATPALLY' }), null);
    assert.equal(branchEditBlocker({ type: BRANCH_TYPE.PHYSICAL }, { isActive: false }), null);
  });

  it('refuses to rename the online branch', () => {
    assert.match(
      branchEditBlocker({ type: BRANCH_TYPE.VIRTUAL }, { name: 'EVERYONE' }) ?? '',
      /renamed/,
    );
  });

  it('refuses to deactivate the online branch', () => {
    assert.match(
      branchEditBlocker({ type: BRANCH_TYPE.VIRTUAL }, { isActive: false }) ?? '',
      /deactivated/,
    );
  });

  it('still permits a no-op patch on the online branch', () => {
    assert.equal(branchEditBlocker({ type: BRANCH_TYPE.VIRTUAL }, {}), null);
    assert.equal(branchEditBlocker({ type: BRANCH_TYPE.VIRTUAL }, { isActive: true }), null);
  });
});

describe('studentBranchBlocker', () => {
  it('keeps an online student out of a physical centre', () => {
    assert.ok(studentBranchBlocker(STUDENT_TYPE.ONLINE, BRANCH_TYPE.PHYSICAL));
  });

  it('keeps an offline student out of the online branch', () => {
    assert.ok(studentBranchBlocker(STUDENT_TYPE.OFFLINE, BRANCH_TYPE.VIRTUAL));
  });

  it('allows each type where it belongs', () => {
    assert.equal(studentBranchBlocker(STUDENT_TYPE.ONLINE, BRANCH_TYPE.VIRTUAL), null);
    assert.equal(studentBranchBlocker(STUDENT_TYPE.OFFLINE, BRANCH_TYPE.PHYSICAL), null);
  });

  /** They sit outside the institute, so the question does not arise for them. */
  it('constrains a non-IACE student to neither', () => {
    assert.equal(studentBranchBlocker(STUDENT_TYPE.NON_IACE, BRANCH_TYPE.VIRTUAL), null);
    assert.equal(studentBranchBlocker(STUDENT_TYPE.NON_IACE, BRANCH_TYPE.PHYSICAL), null);
  });
});

describe('createBranchSchema', () => {
  it('normalises the name on the way in', () => {
    assert.deepEqual(createBranchSchema.parse({ name: ' rtc  x roads ' }), {
      name: 'RTC X ROADS',
      type: BRANCH_TYPE.PHYSICAL,
    });
  });

  it('refuses a name that cannot be tidied into the canonical form', () => {
    assert.equal(createBranchSchema.safeParse({ name: 'RTC-X-ROADS' }).success, false);
  });

  it('takes the type the picker chose', () => {
    assert.equal(
      createBranchSchema.parse({ name: 'ONLINE', type: BRANCH_TYPE.VIRTUAL }).type,
      BRANCH_TYPE.VIRTUAL,
    );
  });

  /**
   * The failure this prevents: `type` arrived after the importer and the sync path were written,
   * and a body without one must still create an ordinary centre rather than fail validation.
   */
  it('defaults to a physical centre when nobody names a type', () => {
    assert.equal(createBranchSchema.parse({ name: 'AMEERPET' }).type, BRANCH_TYPE.PHYSICAL);
  });
});

// ============================================================================

/**
 * A page permission must not become a way to invent a branch. STUDENT_MANAGEMENT is grantable;
 * the branch list every student is assigned against is not.
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

  const superAdmin = { actor: ActorTypes.ADMIN, isSuperAdmin: true, isActive: true };
  const plainAdmin = { actor: ActorTypes.ADMIN, isSuperAdmin: false, isActive: true };
  const student = { actor: ActorTypes.STUDENT, isSuperAdmin: false, isActive: true };
  const deactivatedSuperAdmin = { actor: ActorTypes.ADMIN, isSuperAdmin: true, isActive: false };

  it('lets a super admin through', () => {
    assert.equal(guardFor(true, superAdmin)(), true);
  });

  it('refuses a DEACTIVATED super admin — being one is not enough if switched off', () => {
    assert.throws(guardFor(true, deactivatedSuperAdmin), (error: unknown) => {
      assert.ok(AppException.is(error));
      assert.equal(error.code, ErrorCodes.FORBIDDEN);
      assert.match(error.message, /deactivated/i);
      return true;
    });
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
