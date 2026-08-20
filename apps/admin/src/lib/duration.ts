const SECONDS_PER_MINUTE = 60;

/** Every duration the API takes is seconds; a paper is written and read in minutes. */
export function minutesFieldOf(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '';
  return String(Math.round(seconds / SECONDS_PER_MINUTE));
}

export function secondsFromMinutes(minutes: string): number | null {
  const trimmed = minutes.trim();
  const value = Number(trimmed);
  if (trimmed === '' || Number.isNaN(value)) return null;
  return Math.round(value * SECONDS_PER_MINUTE);
}

export function durationLabel(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  return `${Math.round(seconds / SECONDS_PER_MINUTE)} min`;
}
