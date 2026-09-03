import { WHEN_FORMATTER } from './audit-vocabulary';

/** The API speaks seconds and every screen speaks minutes, so the conversion lives here alone. */

const SECONDS_PER_MINUTE = 60;

export const toMinutes = (seconds: number | null): string =>
  seconds === null ? '' : String(Math.round(seconds / SECONDS_PER_MINUTE));

export const toSeconds = (minutes: string): number | null =>
  minutes.trim() === '' ? null : Number(minutes) * SECONDS_PER_MINUTE;

/** A test with no instant of its own opens when its series does — an absence, not a gap. */
export const opensLabel = (unlockAt: string | null): string =>
  unlockAt ? WHEN_FORMATTER.format(new Date(unlockAt)) : 'With the series';
