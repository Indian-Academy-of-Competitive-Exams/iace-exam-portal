import {
  RECENT_STANDINGS,
  civilDate,
  instituteDateTimeLabel,
  instituteDayLabel,
  testIsOpen,
  todayISO,
  type StudentOverview,
} from '@iace/contracts';
import { type Sittable } from './catalog';

/** "1 test", "12 tests" — the count and its noun, agreeing. Web's own copy lives in `@iace/ui`. */
export function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`;
}

export const LANES = { RUNNING: 'In progress', LIVE: 'Open now', NEXT: 'Up next' } as const;
export type Lane = (typeof LANES)[keyof typeof LANES];

export const laneOf = (row: Sittable): Lane => {
  if (row.action === 'RESUME') return LANES.RUNNING;
  return row.action === 'START' ? LANES.LIVE : LANES.NEXT;
};

export const papersLine = (row: Sittable, now: Date): string =>
  [
    row.seriesName,
    `${plural(row.test.totalQuestions, 'question')} · ${Math.round(row.test.durationSec / 60)} minutes`,
    whenLine(row, now),
  ]
    .filter((part) => part !== null)
    .join(' · ');

function whenLine(row: Sittable, now: Date): string | null {
  const { opensAt } = row.test;
  if (opensAt === null || testIsOpen(opensAt, now)) return null;
  return `opens ${instituteDateTimeLabel(opensAt)}`;
}

/** Whole institute days between two civil dates — never a UTC subtraction on a stored instant. */
function daysSince(at: string): number {
  const then = Date.parse(`${civilDate(new Date(at))}T00:00:00Z`);
  const today = Date.parse(`${todayISO()}T00:00:00Z`);
  return Math.max(0, Math.round((today - then) / 86_400_000));
}

export function lastSatLine(overview: StudentOverview): string | undefined {
  const at = overview.standing.lastAttemptAt;
  if (at === null) return undefined;
  const days = daysSince(at);
  const ago = days === 0 ? 'today' : plural(days, 'day') + ' ago';
  return `Last sat ${instituteDayLabel(at)} · ${ago}`;
}

/** The average alone is half the story; the best is what a student is actually chasing. */
export function bestLine(overview: StudentOverview): string {
  const { avgPercentile, bestPercentile } = overview.standing;
  const over = `average of your last ${RECENT_STANDINGS}`;
  if (bestPercentile === null) return over;
  const spread =
    avgPercentile === null ? '' : ` · ${Math.round(bestPercentile - avgPercentile)} above it`;
  return `${over} · best ${bestPercentile}${spread}`;
}
