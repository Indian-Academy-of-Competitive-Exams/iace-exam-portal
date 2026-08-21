import { BRANCH_TYPE, STUDENT_TYPE, type BranchType, type StudentType } from '@iace/contracts';

/** The rules that keep the branch list trustworthy. */

export interface BranchUsage {
  studentCount: number;
  type: BranchType;
}

/** Every online student sits in the virtual branch, so it is never removable. */
export function branchDeletionBlocker(usage: BranchUsage): string | null {
  if (usage.type === BRANCH_TYPE.VIRTUAL) {
    return 'The online branch is part of the system and cannot be deleted.';
  }
  if (usage.studentCount > 0) {
    return `This branch still has ${usage.studentCount} student${usage.studentCount === 1 ? '' : 's'}. Move them to another branch first.`;
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

/**
 * Virtual is a singleton, not a category. Every rule above says "the online branch", and a
 * second one would be equally unrenameable and undeletable — a typo nobody could ever clear.
 */
export const ONLINE_BRANCH_EXISTS_MESSAGE =
  'The online branch already exists. There can only be one.';

/**
 * Where a student sits has to agree with what kind of student they are: `AccessResolver` reads the
 * branch alone, so an online student parked at a centre inherits that centre's schedule. NON_IACE
 * is deliberately unconstrained — they sit outside the institute, so neither answer is wrong.
 */
export function studentBranchBlocker(
  studentType: StudentType,
  branchType: BranchType,
): string | null {
  if (studentType === STUDENT_TYPE.ONLINE && branchType !== BRANCH_TYPE.VIRTUAL) {
    return 'An online student sits in the online branch, not at a centre.';
  }
  if (studentType === STUDENT_TYPE.OFFLINE && branchType === BRANCH_TYPE.VIRTUAL) {
    return 'An offline student attends a centre, not the online branch.';
  }
  return null;
}

export const INACTIVE_BRANCH_MESSAGE =
  'That branch is no longer active. Pick another, or reactivate it first.';
