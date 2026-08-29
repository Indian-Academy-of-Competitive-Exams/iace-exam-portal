/**
 * Which branches an admin reaches. Read off the request, never from the database, because the
 * claims already carry it — the same trade `permissions` makes, and the same staleness: a branch
 * taken away lands when the access token turns over.
 */
import { ActorTypes, AppException, ErrorCodes } from '@iace/contracts';
import { type AuthenticatedUser } from './authenticated-user';

/** Every branch, or exactly these — and "these" is allowed to be none of them. */
export type BranchScope =
  { readonly all: true } | { readonly all: false; readonly branchIds: readonly string[] };

/** Named, so a caller that means "no admin is asking" says so rather than defaulting into it. */
export const EVERY_BRANCH: BranchScope = { all: true };

/** A super admin bypasses, and so does an admin holding every branch. Everyone else gets their set. */
export function branchScopeOf(user: AuthenticatedUser): BranchScope {
  if (user.actor !== ActorTypes.ADMIN) {
    throw new AppException(ErrorCodes.FORBIDDEN, 'Admin access required');
  }
  // Before the bypasses, as the feature guard does it — some scoped routes have no feature check.
  if (!user.isActive) {
    throw new AppException(
      ErrorCodes.FORBIDDEN,
      'Your account has been deactivated — ask a super admin to restore it',
    );
  }
  if (user.isSuperAdmin || user.allBranches) return EVERY_BRANCH;
  return { all: false, branchIds: user.branchIds };
}

/** `in: []` compiles to a false predicate, which is why an admin given no branch reaches none. */
export function branchScopeWhere(scope: BranchScope): { in: string[] } | undefined {
  return scope.all ? undefined : { in: [...scope.branchIds] };
}

/** Out of scope reads as missing, and a row carrying NO branch is in nobody's scope but everyone's. */
export function assertBranchInScope(scope: BranchScope, branchId: string): void {
  if (scope.all || scope.branchIds.includes(branchId)) return;
  throw new AppException(ErrorCodes.NOT_FOUND, 'No such branch');
}
