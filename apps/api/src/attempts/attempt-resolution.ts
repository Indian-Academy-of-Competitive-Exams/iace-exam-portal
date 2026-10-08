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

export const REFUSALS: Readonly<Record<SupportAction, string>> = {
  [SUPPORT_ACTIONS.FORCE_SUBMIT]: `${LIVE_ONLY}submitted for a student.`,
  [SUPPORT_ACTIONS.EXTEND]: `${LIVE_ONLY}given more time.`,
  // Never backwards: putting a marked sitting back in progress would un-score a real result.
  [SUPPORT_ACTIONS.RESET]: `${LIVE_ONLY}reset. Void it instead.`,
  [SUPPORT_ACTIONS.VOID]: 'This sitting is already void.',
};

/** Why this action cannot be taken on a sitting in this state, or null when it can. */
export function resolutionBlocker(action: SupportAction, status: AttemptStatus): string | null {
  // Whatever was asked: a reset told to "void it instead" on a void sitting would be sent in a circle.
  if (status === ATTEMPT_STATUS.VOIDED) return REFUSALS[SUPPORT_ACTIONS.VOID];
  const allowed = action === SUPPORT_ACTIONS.VOID || status === ATTEMPT_STATUS.IN_PROGRESS;
  return allowed ? null : REFUSALS[action];
}

const SUPPORT_ACTION_FIELD = 'supportAction';

/** The audit row's `changed`, with what was done and why beside whatever fields moved. */
export function supportDiff(
  action: SupportAction,
  reason: string,
  attemptId: string,
  moved: FieldDiff | null,
): FieldDiff {
  return {
    ...moved,
    [SUPPORT_ACTION_FIELD]: { from: null, to: action },
    attemptId: { from: null, to: attemptId },
    reason: { from: null, to: reason },
  };
}

/** A support action is filed under its student, so a reader of the student's own standing tells them apart here. */
export const isSupportDiff = (changed: unknown): boolean =>
  typeof changed === 'object' && changed !== null && SUPPORT_ACTION_FIELD in changed;
