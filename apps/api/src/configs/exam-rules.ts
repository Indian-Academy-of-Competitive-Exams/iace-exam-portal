/** The rules that keep the exam catalog trustworthy. */

export interface ExamUsage {
  stageCount: number;
  studentCount: number;
}

function countOf(count: number, noun: string, plural = `${noun}s`): string | null {
  if (count === 0) return null;
  return `${count} ${count === 1 ? noun : plural}`;
}

/**
 * Both counts matter: a stage carries the configs, series and tests built on it, so an exam
 * with stages is holding far more than the two rows a delete would appear to touch.
 */
export function examDeletionBlocker(usage: ExamUsage): string | null {
  const held = [
    countOf(usage.stageCount, 'stage'),
    countOf(usage.studentCount, 'enrolled student'),
  ].filter((part): part is string => part !== null);

  if (held.length === 0) return null;
  return `This exam is still used by ${held.join(', ')}. Retire it instead — a retired exam keeps everything it has and is simply no longer offered.`;
}

/**
 * `Student.enrolledExams` stores the code as free text with no foreign key, so a rename would
 * detach every enrolment with no error and no rows changed.
 */
export function examEditBlocker(
  usage: Pick<ExamUsage, 'studentCount'>,
  changes: { code?: string },
): string | null {
  if (changes.code === undefined || usage.studentCount === 0) return null;

  const subject = countOf(usage.studentCount, 'enrolled student');
  const verb = usage.studentCount === 1 ? 'holds' : 'hold';
  return `${subject} already ${verb} this code, and nothing links them back to this row — changing it would detach every one of them silently. Create a second exam instead.`;
}

export const INACTIVE_EXAM_MESSAGE =
  'That exam is no longer active. Pick another, or reactivate it first.';

export interface StageUsage {
  configCount: number;
  testCount: number;
  seriesCount: number;
}

/**
 * A stage is the level everything hangs off: its base configs cascade to their sections, and a
 * series or a test pointing at it survives with nothing to describe it.
 */
export function stageDeletionBlocker(usage: StageUsage): string | null {
  const held = [
    countOf(usage.configCount, 'base config'),
    countOf(usage.testCount, 'test'),
    countOf(usage.seriesCount, 'series', 'series'),
  ].filter((part): part is string => part !== null);

  if (held.length === 0) return null;
  return `This stage is still used by ${held.join(', ')}. Retire it instead — a retired stage keeps everything it has and is simply no longer offered.`;
}

/**
 * `stageKey` is what the exam-pattern workbook and every seed script address a stage by, with no
 * foreign key behind it — a rename detaches all of them silently.
 */
export function stageEditBlocker(
  usage: Pick<StageUsage, 'configCount'>,
  changes: { stageKey?: string },
): string | null {
  if (changes.stageKey === undefined || usage.configCount === 0) return null;

  return `${countOf(usage.configCount, 'base config')} already hangs off this key, and nothing links back to this row — changing it would detach them silently. Create a second stage instead.`;
}

export const INACTIVE_STAGE_MESSAGE =
  'That stage is no longer active. Pick another, or reactivate it first.';

export const CATALOG_ONLY_STAGE_MESSAGE =
  'That stage is listed for the journey only — nobody sits it here, so it carries no paper.';
