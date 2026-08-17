/** The rules that keep the branch list trustworthy. */

export interface BranchUsage {
  groupCount: number;
  isGlobal: boolean;
}

/** A branch may only be deleted once no group sits under it, and GLOBAL never. */
export function branchDeletionBlocker(usage: BranchUsage): string | null {
  if (usage.isGlobal) {
    return 'GLOBAL is part of the system and cannot be deleted.';
  }
  if (usage.groupCount > 0) {
    return `This branch still has ${usage.groupCount} group${usage.groupCount === 1 ? '' : 's'}. Move or delete them first.`;
  }
  return null;
}

/** GLOBAL cannot be renamed or retired either. */
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
