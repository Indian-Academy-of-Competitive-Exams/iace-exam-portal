/** The rules that keep the exam-type catalog trustworthy. */

export interface ExamTypeUsage {
  groupCount: number;
  studentCount: number;
  baseConfigCount: number;
  testCount: number;
}

function countOf(count: number, noun: string): string | null {
  if (count === 0) return null;
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * All four counts matter: a base config cascades and takes its sections with it, and a test
 * reachable only through a config is invisible to a count on `Test.examTypeId` alone.
 */
export function examTypeDeletionBlocker(usage: ExamTypeUsage): string | null {
  const held = [
    countOf(usage.groupCount, 'group'),
    countOf(usage.studentCount, 'enrolled student'),
    countOf(usage.baseConfigCount, 'base config'),
    countOf(usage.testCount, 'test'),
  ].filter((part): part is string => part !== null);

  if (held.length === 0) return null;
  return `This exam type is still used by ${held.join(', ')}. Retire it instead — a retired exam type keeps everything it has and is simply no longer offered.`;
}

/**
 * `Group.examType` and `Student.enrolledExams` store the code as free text with no foreign key, so
 * a rename would detach every one of them with no error and no rows changed.
 */
export function examTypeEditBlocker(
  usage: ExamTypeUsage,
  changes: { name?: string; code?: string; isActive?: boolean },
): string | null {
  if (changes.code === undefined) return null;

  const attached = [
    countOf(usage.groupCount, 'group'),
    countOf(usage.studentCount, 'enrolled student'),
  ].filter((part): part is string => part !== null);

  if (attached.length === 0) return null;

  const subjectText = attached.join(' and ');
  const isPlural = attached.length > 1 || usage.groupCount > 1 || usage.studentCount > 1;
  const verb = isPlural ? 'hold' : 'holds';
  return `${subjectText} already ${verb} this code, and nothing links them back to this row — changing it would detach every one of them silently. Create a second exam type instead.`;
}

export const INACTIVE_EXAM_TYPE_MESSAGE =
  'That exam type is no longer active. Pick another, or reactivate it first.';
