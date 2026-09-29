import { TEST_STATUS, type AttemptStatus, type TestStatus } from '@iace/contracts';
import { MS_PER_SECOND } from '../common/time/units';

/** The rules that decide whether a sitting may begin — pure, so no database is needed to test them. */

export const TEST_NOT_OFFERED_MESSAGE =
  'This test is not being offered right now. Ask your branch if you think that is wrong.';

export const PAPER_NOT_READY_MESSAGE =
  'This test has not been offered yet, so it has no paper to sit.';

/** What stops a test being sat at all, whatever the student's access says. */
export function testStartBlocker(test: {
  status: TestStatus;
  finalizedAt: Date | null;
}): string | null {
  if (test.status !== TEST_STATUS.ACTIVE) return TEST_NOT_OFFERED_MESSAGE;
  // Until the freeze the paper can still move, so there is nothing settled to sit.
  if (test.finalizedAt === null) return PAPER_NOT_READY_MESSAGE;
  return null;
}

/** One ended sitting, as the start gate reads it. A voided one did not happen. */
export interface EndedSitting {
  status: AttemptStatus;
  isGraded: boolean;
}

/** What a student's ended sittings leave for the next one. */
export interface SittingSlots {
  attemptNo: number;
  ranksAgain: boolean;
}

/** The number the next sitting takes, and whether it is the one that ranks. */
export function slotsAfter(ended: readonly EndedSitting[]): SittingSlots {
  return {
    // Every sitting counts here, void included: the attempt number is a unique key, not a tally.
    attemptNo: ended.length + 1,
    // Spent unless a void handed it back: the slot is held by whichever sitting still carries it.
    ranksAgain: !ended.some((row) => row.isGraded),
  };
}

/** The deadline is the server's, computed once at start and never recomputed. */
export function deadlineFrom(startedAt: Date, durationSec: number): Date {
  return new Date(startedAt.getTime() + durationSec * MS_PER_SECOND);
}
