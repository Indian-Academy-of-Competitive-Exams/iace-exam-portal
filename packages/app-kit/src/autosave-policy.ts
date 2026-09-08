/**
 * When a sitting sends what it has, and under which revision.
 * A timer alone makes 5,000 clients save in lockstep; a counter that restarts at 0
 * makes the server drop every batch behind what it already holds.
 */

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

/** The client's counter, never backwards: below what the server holds, every batch is dropped. */
export function seedRevision(current: number, held: number): number {
  return Math.max(current, held);
}
