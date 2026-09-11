/** Ranking's reading of how long a sitting took: less time wins a tie on marks. */
import { elapsedSeconds } from './attempt-report';

export const LEADERBOARD_MAX_TIME_SEC = 24 * 60 * 60;

/** Start to submit, never more than a day; an unfinished sitting is the slowest there is. */
export function timeTakenSec(startedAt: Date, submittedAt: Date | null): number {
  if (submittedAt === null) return LEADERBOARD_MAX_TIME_SEC;
  return Math.min(elapsedSeconds(startedAt, submittedAt), LEADERBOARD_MAX_TIME_SEC);
}
