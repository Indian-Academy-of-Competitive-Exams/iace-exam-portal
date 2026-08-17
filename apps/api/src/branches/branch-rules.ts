import { BRANCH_TYPE, type BranchType } from '@iace/contracts';

/** The rules that keep the branch list trustworthy. */

export interface BranchUsage {
  groupCount: number;
  type: BranchType;
}

/** Every online student sits in the virtual branch, so it is never removable. */
export function branchDeletionBlocker(usage: BranchUsage): string | null {
  if (usage.type === BRANCH_TYPE.VIRTUAL) {
    return 'The online branch is part of the system and cannot be deleted.';
  }
  if (usage.groupCount > 0) {
    return `This branch still has ${usage.groupCount} group${usage.groupCount === 1 ? '' : 's'}. Move or delete them first.`;
  }
  return null;
}

/** Nor renamed or retired — every online student would lose their branch. */
export function branchEditBlocker(
  usage: Pick<BranchUsage, 'type'>,
  changes: { name?: string; isActive?: boolean },
): string | null {
  if (usage.type !== BRANCH_TYPE.VIRTUAL) return null;
  if (changes.name !== undefined) return 'The online branch cannot be renamed.';
  if (changes.isActive === false) return 'The online branch cannot be deactivated.';
  return null;
}

export const INACTIVE_BRANCH_MESSAGE =
  'That branch is no longer active. Pick another, or reactivate it first.';
