/**
 * The two rules that follow from access running Student → Group → TestSeries →
 * Test. Both are pure so they can be tested directly, and both exist to stop a
 * routine bit of admin housekeeping from quietly revoking someone's access.
 */

export interface GroupUsage {
  studentCount: number;
  testSeriesCount: number;
}

/**
 * A group may only be deleted once nothing depends on it.
 *
 * Deleting a populated group would strip every member's route to their tests,
 * and — because a student must stay in at least one group — could leave them
 * reachable by nothing at all. Emptying it first is a deliberate act; deleting
 * it is otherwise a silent one.
 *
 * Returns the reason it cannot be deleted, or null when it can.
 */
export function groupDeletionBlocker(usage: GroupUsage): string | null {
  if (usage.studentCount > 0) {
    return `This batch still has ${usage.studentCount} student${usage.studentCount === 1 ? '' : 's'}. Move them to another batch first.`;
  }
  if (usage.testSeriesCount > 0) {
    return 'This batch is still linked to a test series. Unlink it first.';
  }
  return null;
}

/**
 * Whether a student can be taken out of one of their groups.
 *
 * `groupCount` is how many groups they are in BEFORE the removal. Dropping to
 * zero would leave them with no path to any test, which reads to the student as
 * "everything vanished" and to the admin as a successful click.
 */
export function canRemoveFromGroup(groupCount: number): boolean {
  return groupCount > 1;
}

export const LAST_GROUP_MESSAGE =
  'This is the student’s only batch. Add them to another one before removing this.';
