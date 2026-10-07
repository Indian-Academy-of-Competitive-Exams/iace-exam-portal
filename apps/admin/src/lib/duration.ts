import { instituteDateTimeLabel } from '@iace/contracts';
import { optionalNumber } from '@iace/app-kit';

const SECONDS_PER_MINUTE = 60;

/** Every duration the API takes is seconds; a paper is written and read in minutes. */
export function minutesFieldOf(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '';
  // Two decimals sit within 0.3s of the seconds, so a save rounds back to exactly them.
  return String(Number((seconds / SECONDS_PER_MINUTE).toFixed(2)));
}

export function secondsFromMinutes(minutes: string): number | null {
  const value = optionalNumber(minutes);
  return value === null ? null : Math.round(value * SECONDS_PER_MINUTE);
}

export function durationLabel(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  return `${Number((seconds / SECONDS_PER_MINUTE).toFixed(1))} min`;
}

/** Per-question time, which a paper is read in seconds rather than minutes. */
export function secondsLabel(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  return `${Math.round(seconds)}s`;
}

/** A test with no instant of its own opens once it is active — an absence, not a gap. */
export const opensLabel = (unlockAt: string | null): string =>
  unlockAt ? instituteDateTimeLabel(unlockAt) : 'Once active';
