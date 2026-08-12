/**
 * The rules that keep the branch list trustworthy. All pure, so they can be
 * tested without a database, and all exist to stop a list that everything else
 * picks from being edited out from under those choices.
 */

export interface BranchUsage {
  groupCount: number;
  isGlobal: boolean;
}

/**
 * A branch may only be deleted once no group sits under it, and GLOBAL never.
 *
 * Deleting a branch with groups would take those groups' students' access with
 * it. GLOBAL is refused outright: it is the home for every group that belongs
 * to no physical centre, and nothing re-creates it if it goes.
 *
 * Returns the reason it cannot be deleted, or null when it can.
 */
export function branchDeletionBlocker(usage: BranchUsage): string | null {
  if (usage.isGlobal) {
    return 'GLOBAL is part of the system and cannot be deleted.';
  }
  if (usage.groupCount > 0) {
    return `This branch still has ${usage.groupCount} group${usage.groupCount === 1 ? '' : 's'}. Move or delete them first.`;
  }
  return null;
}

/**
 * GLOBAL cannot be renamed or retired either.
 *
 * Retiring it would stop cross-branch groups being created with no way back,
 * and renaming it would leave the one branch every admin recognises called
 * something else — while `isGlobal`, not the name, is what code goes by.
 */
export function branchEditBlocker(
  usage: Pick<BranchUsage, 'isGlobal'>,
  changes: { name?: string; isActive?: boolean },
): string | null {
  if (!usage.isGlobal) return null;
  if (changes.name !== undefined) return 'GLOBAL cannot be renamed.';
  if (changes.isActive === false) return 'GLOBAL cannot be deactivated.';
  return null;
}

export const INACTIVE_BRANCH_MESSAGE =
  'That branch is no longer active. Pick another, or reactivate it first.';
