/** Asking again for a queued result: quickly at first, then backing off to a ceiling. */

export const POLL_FIRST_MS = 500;
export const POLL_MAX_MS = 3_000;

/** Past this the job is not slow, it is gone, and the screen owes the student an error. */
export const POLL_GIVES_UP_AFTER = 100;

export function pollDelayMs(attempt: number): number {
  return Math.min(POLL_FIRST_MS * 2 ** attempt, POLL_MAX_MS);
}
