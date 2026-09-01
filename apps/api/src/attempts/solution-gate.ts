/**
 * The one rule the answer key rides on. A key released while somebody can still sit the paper is
 * a key released to them, so a SCHEDULED ranked test waits until entry has shut everywhere and
 * the last sitting that could have started has ended. Nothing else here decides anything.
 */
import { EVALUATION_MODE, type EvaluationMode } from '@iace/contracts';
import { lastSittingEndsAt } from './attempt-report';

/** SHUT is not "later": it is a scheduled test nobody has capped entry on, so no date can be named. */
export const SOLUTIONS_OPENING = { NOW: 'NOW', AT: 'AT', SHUT: 'SHUT' } as const;

export type SolutionsOpening =
  | { state: typeof SOLUTIONS_OPENING.NOW }
  | { state: typeof SOLUTIONS_OPENING.AT; at: string }
  | { state: typeof SOLUTIONS_OPENING.SHUT };

export interface SolutionGateFacts {
  evaluationMode: EvaluationMode;
  /** True when the test is offered inside a series — a sitting the institute arranged. */
  scheduled: boolean;
  /** When entry shuts everywhere. Null while any branch can still let somebody in. */
  closesAt: string | null;
  durationSec: number;
  extraTimeSec: number;
}

/** The gate's inputs, gathered from the sitting and the window its branches leave open. */
export function gateFacts(
  attempt: { test: { evaluationMode: EvaluationMode; baseConfig: { durationSec: number } } },
  schedule: { scheduled: boolean; closesAt: string | null; extraTimeSec: number },
): SolutionGateFacts {
  return {
    evaluationMode: attempt.test.evaluationMode,
    scheduled: schedule.scheduled,
    closesAt: schedule.closesAt,
    durationSec: attempt.test.baseConfig.durationSec,
    extraTimeSec: schedule.extraTimeSec,
  };
}

export function solutionsOpening(facts: SolutionGateFacts): SolutionsOpening {
  if (facts.evaluationMode === EVALUATION_MODE.PRACTICE) return { state: SOLUTIONS_OPENING.NOW };
  // Standalone: no series arranged it, so there is no cohort whose sitting this could spoil.
  if (!facts.scheduled) return { state: SOLUTIONS_OPENING.NOW };

  const at = lastSittingEndsAt(facts.closesAt, facts.durationSec, facts.extraTimeSec);
  return at === null ? { state: SOLUTIONS_OPENING.SHUT } : { state: SOLUTIONS_OPENING.AT, at };
}

export function solutionsAreOpen(facts: SolutionGateFacts, now: Date): boolean {
  const opening = solutionsOpening(facts);
  if (opening.state === SOLUTIONS_OPENING.NOW) return true;
  if (opening.state === SOLUTIONS_OPENING.SHUT) return false;
  return Date.parse(opening.at) <= now.getTime();
}

/** The instant a screen may count down to, or null when there is no date anyone can promise. */
export function solutionsOpenAt(facts: SolutionGateFacts): string | null {
  const opening = solutionsOpening(facts);
  return opening.state === SOLUTIONS_OPENING.AT ? opening.at : null;
}

/** What a student is told while it is shut. It never names a date the gate cannot keep. */
export function solutionsClosedReason(facts: SolutionGateFacts): string {
  return solutionsOpenAt(facts) === null
    ? 'Solutions open once this test has closed for everyone sitting it.'
    : 'Solutions open once the last sitting of this test has finished.';
}
