/** When a sitting sends what it has. A timer alone makes 5,000 clients save in lockstep. */

export const AUTOSAVE_EVERY_MS = 25_000;

/** Spread around the timer, so sittings that began together do not come back together. */
export const AUTOSAVE_JITTER_MS = 5_000;

/** Enough unsaved answers that waiting for the timer risks losing real work. */
export const AUTOSAVE_AT_COUNT = 20;

export function autosaveDelayMs(random: () => number = Math.random): number {
  return AUTOSAVE_EVERY_MS + Math.round((random() * 2 - 1) * AUTOSAVE_JITTER_MS);
}

export function shouldFlushNow(pendingCount: number): boolean {
  return pendingCount >= AUTOSAVE_AT_COUNT;
}
