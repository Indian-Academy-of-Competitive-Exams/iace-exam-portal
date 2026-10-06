/** The arithmetic every report shares: a figure with nothing under it is a blank, never a nought. */
import { round2 } from '@iace/contracts';

const PERCENT = 100;
const MINUTE_SEC = 60;

export function percentOf(part: number, whole: number): number | null {
  return whole === 0 ? null : round2((part / whole) * PERCENT);
}

export function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export const highestOf = (values: readonly number[]): number | null =>
  values.length === 0 ? null : Math.max(...values);

/** Seconds as minutes: a page reads "42.5" where a column of "2550" has to be worked out. */
export const minutesOf = (seconds: number | null): number | null =>
  seconds === null ? null : round2(seconds / MINUTE_SEC);

/** Rows gathered under one key, in the order each key was first met. */
export function groupBy<Row, Key>(rows: readonly Row[], keyOf: (row: Row) => Key): Map<Key, Row[]> {
  const groups = new Map<Key, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}
