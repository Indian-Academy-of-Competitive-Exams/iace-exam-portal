/** The two rules that follow from access running Student → Group → TestSeries → Test. */

export interface GroupUsage {
  studentCount: number;
  testSeriesCount: number;
}

/** A group may only be deleted once nothing depends on it. */
export function groupDeletionBlocker(usage: GroupUsage): string | null {
  if (usage.studentCount > 0) {
    return `This group still has ${usage.studentCount} student${usage.studentCount === 1 ? '' : 's'}. Move them to another group first.`;
  }
  if (usage.testSeriesCount > 0) {
    return 'This group is still linked to a test series. Unlink it first.';
  }
  return null;
}

/** Whether a student can be taken out of one of their groups. */
export function canRemoveFromGroup(groupCount: number): boolean {
  return groupCount > 1;
}

export const LAST_GROUP_MESSAGE =
  'This is the student’s only group. Add them to another one before removing this.';
