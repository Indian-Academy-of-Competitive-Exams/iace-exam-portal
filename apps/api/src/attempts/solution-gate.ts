/**
 * The one rule the answer key rides on. A ranked test whose entry is CAPPED waits until the last
 * sitting that could have started has ended, so the key is never released to somebody who can
 * still sit. Uncapped, there is no such instant, so the key opens on the student's own evaluated
 * sitting — a deliberate trade: entry that never shuts would otherwise hold solutions for ever.
 */
import { EVALUATION_MODE, type EvaluationMode } from '@iace/contracts';
import { lastSittingEndsAt } from './attempt-report';

/** NOW is the student's own evaluated sitting; AT is an instant a capped test can name. */
export const SOLUTIONS_OPENING = { NOW: 'NOW', AT: 'AT' } as const;

export type SolutionsOpening =
  { state: typeof SOLUTIONS_OPENING.NOW } | { state: typeof SOLUTIONS_OPENING.AT; at: string };

export interface SolutionGateFacts {
  evaluationMode: EvaluationMode;
  /** When entry shuts everywhere. Null while any branch can still let somebody in. */
  closesAt: string | null;
  durationSec: number;
  extraTimeSec: number;
}

/** The gate's inputs, gathered from the sitting and the window its branches leave open. */
export function gateFacts(
  attempt: { test: { evaluationMode: EvaluationMode; baseConfig: { durationSec: number } } },
  schedule: { closesAt: string | null; extraTimeSec: number },
): SolutionGateFacts {
  return {
    evaluationMode: attempt.test.evaluationMode,
    closesAt: schedule.closesAt,
    durationSec: attempt.test.baseConfig.durationSec,
    extraTimeSec: schedule.extraTimeSec,
  };
}

export function solutionsOpening(facts: SolutionGateFacts): SolutionsOpening {
  if (facts.evaluationMode === EVALUATION_MODE.PRACTICE) return { state: SOLUTIONS_OPENING.NOW };

  const at = lastSittingEndsAt(facts.closesAt, facts.durationSec, facts.extraTimeSec);
  return at === null ? { state: SOLUTIONS_OPENING.NOW } : { state: SOLUTIONS_OPENING.AT, at };
}

export function solutionsAreOpen(facts: SolutionGateFacts, now: Date): boolean {
  const opening = solutionsOpening(facts);
  if (opening.state === SOLUTIONS_OPENING.NOW) return true;

  return Date.parse(opening.at) <= now.getTime();
}

/** The instant a screen may count down to, or null when there is no date anyone can promise. */
export function solutionsOpenAt(facts: SolutionGateFacts): string | null {
  const opening = solutionsOpening(facts);
  return opening.state === SOLUTIONS_OPENING.AT ? opening.at : null;
}

/** Only a capped test can be closed now, and it always has a date, so this never guesses. */
export function solutionsClosedReason(_facts: SolutionGateFacts): string {
  return 'Solutions open once the last sitting of this test has finished.';
}
