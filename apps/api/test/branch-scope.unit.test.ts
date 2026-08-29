import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActorTypes, AppException, ErrorCodes } from '@iace/contracts';
import {
  assertBranchInScope,
  branchScopeOf,
  branchScopeWhere,
} from '../src/common/security/branch-scope';
import { type AuthenticatedUser } from '../src/common/security/authenticated-user';

const admin = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'adm_1',
  actor: ActorTypes.ADMIN,
  sessionId: 'sess_1',
  isSuperAdmin: false,
  isActive: true,
  permissions: {},
  allBranches: false,
  branchIds: ['br_1', 'br_2'],
  ...over,
});

describe('branchScopeOf', () => {
  it('gives a branch admin exactly the branches they hold', () => {
    const scope = branchScopeOf(admin());

    assert.deepEqual(scope, { all: false, branchIds: ['br_1', 'br_2'] });
  });

  it('lets a super admin past, whatever branches they were given', () => {
    assert.deepEqual(branchScopeOf(admin({ isSuperAdmin: true, branchIds: [] })), { all: true });
  });

  it('lets an admin holding every branch past', () => {
    assert.deepEqual(branchScopeOf(admin({ allBranches: true, branchIds: [] })), { all: true });
  });

  /** The failure this prevents: reading "no branches yet" as "every branch". */
  it('gives an admin with no branches none of them, never all', () => {
    const scope = branchScopeOf(admin({ branchIds: [] }));

    assert.deepEqual(scope, { all: false, branchIds: [] });
    assert.deepEqual(branchScopeWhere(scope), { in: [] });
  });

  /** The routes a scope guards carry no feature check, so this is where a deactivated admin stops. */
  it('refuses a deactivated admin, even one who holds every branch', () => {
    const error = ((): unknown => {
      try {
        return branchScopeOf(admin({ isActive: false, allBranches: true, isSuperAdmin: true }));
      } catch (thrown: unknown) {
        return thrown;
      }
    })();

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.FORBIDDEN);
  });

  it('refuses anyone who is not an admin', () => {
    const error = ((): unknown => {
      try {
        return branchScopeOf(admin({ actor: ActorTypes.STUDENT }));
      } catch (thrown: unknown) {
        return thrown;
      }
    })();

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.FORBIDDEN);
  });
});

describe('branchScopeWhere', () => {
  it('narrows nothing when every branch is in scope', () => {
    assert.equal(branchScopeWhere({ all: true }), undefined);
  });

  it('narrows to the branches held', () => {
    assert.deepEqual(branchScopeWhere({ all: false, branchIds: ['br_1'] }), { in: ['br_1'] });
  });
});

describe('assertBranchInScope', () => {
  it('passes a branch the admin holds', () => {
    assert.doesNotThrow(() => assertBranchInScope({ all: false, branchIds: ['br_1'] }, 'br_1'));
  });

  it('passes anything when every branch is in scope', () => {
    assert.doesNotThrow(() => assertBranchInScope({ all: true }, 'br_9'));
  });

  /** NOT_FOUND, never FORBIDDEN: an id is not a thing to confirm the existence of. */
  it('reads a branch they do not hold as missing', () => {
    const error = ((): unknown => {
      try {
        return assertBranchInScope({ all: false, branchIds: ['br_1'] }, 'br_2');
      } catch (thrown: unknown) {
        return thrown;
      }
    })();

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });
});
