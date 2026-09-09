import { ATTEMPT_STATUS, type AttemptStatus, type FieldDiff } from '@iace/contracts';

/** The rules a support action is judged by — pure, so no database is needed to test them. */

/** What an admin can do to one sitting. The value is what the audit row is read back by. */
export const SUPPORT_ACTIONS = {
  FORCE_SUBMIT: 'FORCE_SUBMIT',
  EXTEND: 'EXTEND',
  RESET: 'RESET',
  VOID: 'VOID',
} as const;
export type SupportAction = (typeof SUPPORT_ACTIONS)[keyof typeof SUPPORT_ACTIONS];

const LIVE_ONLY = 'Only a sitting still in progress can be ';

const REFUSALS: Readonly<Record<SupportAction, string>> = {
  [SUPPORT_ACTIONS.FORCE_SUBMIT]: `${LIVE_ONLY}submitted for a student.`,
  [SUPPORT_ACTIONS.EXTEND]: `${LIVE_ONLY}given more time.`,
  // Never backwards: putting a marked sitting back in progress would un-score a real result.
  [SUPPORT_ACTIONS.RESET]: `${LIVE_ONLY}reset. Void it instead.`,
  [SUPPORT_ACTIONS.VOID]: 'This sitting is already void.',
};

/** Why this action cannot be taken on a sitting in this state, or null when it can. */
export function resolutionBlocker(action: SupportAction, status: AttemptStatus): string | null {
  const allowed =
    action === SUPPORT_ACTIONS.VOID
      ? status !== ATTEMPT_STATUS.VOIDED
      : status === ATTEMPT_STATUS.IN_PROGRESS;
  return allowed ? null : REFUSALS[action];
}

/** Counted from now once the deadline has gone, or extending a stuck sitting buys nothing. */
export function extendedEndsAt(endsAt: Date, minutes: number, now: Date): Date {
  const from = Math.max(endsAt.getTime(), now.getTime());
  return new Date(from + minutes * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND);
}

/** Whether the void hands the ranked slot back. Spent by default; only a fault earns it back. */
export function regrantsRankedSlot(isGraded: boolean, asked: boolean): boolean {
  return isGraded && asked;
}

/** The audit row's `changed`, with what was done and why beside whatever fields moved. */
export function supportDiff(
  action: SupportAction,
  reason: string,
  attemptId: string,
  moved: FieldDiff | null,
): FieldDiff {
  return {
    ...moved,
    supportAction: { from: null, to: action },
    attemptId: { from: null, to: attemptId },
    reason: { from: null, to: reason },
  };
}

const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;
