/**
 * Where a sitting sits in its cohort, worked out without Redis so the packing can be read.
 * A sorted set holds ONE double per member and a rank is two facts, so both are packed into it:
 * marks scaled past every possible time, plus a time term counted DOWN. More marks therefore
 * always outranks fewer, and at equal marks less time wins.
 */
export const LEADERBOARD_MAX_TIME_SEC = 24 * 60 * 60;

/** One more than the widest time, so the minor term can never reach into the marks above it. */
const TIME_SPAN = LEADERBOARD_MAX_TIME_SEC + 1;

/** Marks are Decimal(8,2); packed as whole hundredths they stay exact integers inside the double. */
const HUNDREDTHS = 100;

export function compositeScore(marks: number, timeTakenSec: number): number {
  const spent = Math.min(Math.max(Math.round(timeTakenSec), 0), LEADERBOARD_MAX_TIME_SEC);
  return marksFloor(marks) + (LEADERBOARD_MAX_TIME_SEC - spent);
}

/** The lowest composite anyone on these marks can hold — a slower sitting cannot go under it. */
export function marksFloor(marks: number): number {
  return Math.round(marks * HUNDREDTHS) * TIME_SPAN;
}

/** The marks band one composite belongs to, so rank and percentile read the same single fact. */
export function bandOf(composite: number): { floor: number; ceiling: number } {
  const floor = Math.floor(composite / TIME_SPAN) * TIME_SPAN;
  return { floor, ceiling: floor + LEADERBOARD_MAX_TIME_SEC };
}

/** How long the sitting took. One with no submission is treated as having taken the whole day. */
export function timeTakenSec(startedAt: Date, submittedAt: Date | null): number {
  if (submittedAt === null) return LEADERBOARD_MAX_TIME_SEC;
  return Math.max(0, Math.round((submittedAt.getTime() - startedAt.getTime()) / MS_PER_SECOND));
}

/** Percentile rank, counting a tie as half. `tied` includes this sitting itself. */
export function percentileOf(outscored: number, tied: number, cohortSize: number): number {
  // A field of one is its own top; reporting the median of a field of one reads as a failure.
  if (cohortSize <= 1) return 100;

  const beaten = clamp(outscored, 0, cohortSize);
  const shared = clamp(tied, 1, cohortSize - beaten);
  const share = Math.min((beaten + shared / 2) / cohortSize, 1);
  return Math.round(share * 100 * HUNDREDTHS) / HUNDREDTHS;
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(high, low));

const MS_PER_SECOND = 1000;
