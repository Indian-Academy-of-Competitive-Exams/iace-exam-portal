/**
 * When a sitting sends what it has, and under which revision.
 * A timer alone makes 5,000 clients save in lockstep; a counter that restarts at 0
 * makes the server drop every batch behind what it already holds.
 */
import { PRESENT_GRACE_SEC } from '@iace/contracts';
import { isWorthAskingAgain } from './query-client';

export const AUTOSAVE_EVERY_MS = 25_000;

/** Spread around the timer, so sittings that began together do not come back together. */
export const AUTOSAVE_JITTER_MS = 5_000;

/** Enough unsaved answers that waiting for the timer risks losing real work. */
export const AUTOSAVE_AT_COUNT = 20;

/** Given up before the earliest next tick (25s less the jitter), so one hang cannot swallow two intervals of taps. */
export const SAVE_TIMEOUT_MS = 15_000;

/** How long the paper waits on a save in the air: its 1s+2s+4s retries still land inside the server's 30s grace. */
export const FINISH_WAIT_MS = 5_000;

/** The slowest try: behind FINISH_WAIT_MS and the 1s+2s waits, three hangs still leave 5s, 16s and 28s into the 30s grace. */
export const SUBMIT_TIMEOUT_MS = 10_000;

export function autosaveDelayMs(random: () => number = Math.random): number {
  return AUTOSAVE_EVERY_MS + Math.round((random() * 2 - 1) * AUTOSAVE_JITTER_MS);
}

/** An idle screen says it is here only while in touch: past the grace, a beat would spend the pause a reload gives back. */
export function shouldHeartbeat(heardAtMs: number, nowMs: number): boolean {
  return nowMs - heardAtMs < PRESENT_GRACE_SEC * 1000;
}

export function shouldFlushNow(pendingCount: number): boolean {
  return pendingCount >= AUTOSAVE_AT_COUNT;
}

/** The client's counter, never backwards: below what the server holds, every batch is dropped. */
export function seedRevision(current: number, held: number): number {
  return Math.max(current, held);
}

/** A refusal is an answer; a throttle or a server fault never reached the paper, so it is sent again. */
export function shouldRetrySubmit(failures: number, error: unknown): boolean {
  return failures < 3 && isWorthAskingAgain(error);
}

/** 1s, 2s, 4s after the first, second and third failure: well inside the server's 30s grace. */
export const submitRetryDelayMs = (failures: number): number =>
  Math.min(1_000 * 2 ** failures, 8_000);
