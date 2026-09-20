/** Asking again for a queued result: quickly at first, then backing off to a jittered ceiling. */

export const POLL_FIRST_MS = 500;
export const POLL_MAX_MS = 8_000;

/** Past this the job is not slow, it is gone, and the screen owes the student an error. */
export const POLL_GIVES_UP_AFTER = 30;

/** Half the step, plus up to half again: a hall that handed in together asks in a spread, not a pulse. */
export function pollDelayMs(attempt: number, random: () => number = Math.random): number {
  const step = Math.min(POLL_FIRST_MS * 2 ** attempt, POLL_MAX_MS);
  return Math.round(step / 2 + random() * (step / 2));
}

export function shouldKeepPolling(attempt: number): boolean {
  return attempt < POLL_GIVES_UP_AFTER;
}
