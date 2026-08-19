import { GROUP_TYPE, type GroupType } from '@iace/contracts';

/** The rules that keep a group's membership and the group list trustworthy. */

export interface GroupUsage {
  type: GroupType;
  studentCount: number;
  testSeriesCount: number;
}

/** A group may only be deleted once nothing depends on it. */
export function groupDeletionBlocker(usage: GroupUsage): string | null {
  if (usage.type === GROUP_TYPE.GLOBAL) {
    return 'The all-students group is part of the system and cannot be deleted.';
  }
  if (usage.studentCount > 0) {
    return `This group still has ${usage.studentCount} student${usage.studentCount === 1 ? '' : 's'}. Move them to another group first.`;
  }
  if (usage.testSeriesCount > 0) {
    return 'This group is still linked to a test series. Unlink it first.';
  }
  return null;
}

/** Every student is in the all-students group, and nothing re-creates it. */
export function groupEditBlocker(
  group: { type: GroupType },
  changes: { name?: string; isActive?: boolean },
): string | null {
  if (group.type !== GROUP_TYPE.GLOBAL) return null;
  if (changes.name !== undefined) return 'The all-students group cannot be renamed.';
  // Both directions, and a no-op too: this row has no editable state at all.
  if (changes.isActive !== undefined) return 'The all-students group cannot be retired.';
  return null;
}
