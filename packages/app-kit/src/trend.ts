/** The line a student's sittings draw on both clients: which figure it plots, and what it is read against. */
import { type PerformancePoint } from '@iace/contracts';

/** Where a percentile stops being a middle and starts being a placing worth chasing. */
export const TOP_QUARTER = { from: 75, to: 100, label: 'Top quarter' } as const;

export interface Trendline {
  title: string;
  suffix: string;
  /** A null value is nothing to plot, which is not zero: it draws no marker and breaks the line. */
  points: { key: string; label: string; value: number | null; caption: string }[];
  band?: { from: number; to: number; label: string };
  reference?: { value: number; label: string };
}

/** A percentile needs a marked ranked sitting; until there is one the same line reads the marks. */
export function trendOf(points: readonly PerformancePoint[]): Trendline | null {
  // One sitting is a figure, not a trend.
  if (points.length < 2) return null;
  const ranked = points.some((point) => point.percentile !== null);

  const plotted = points.map((point) => ({
    key: point.attemptId,
    label: point.testTitle ?? 'Untitled test',
    value: ranked ? point.percentile : point.percentage,
    caption: `${point.score} of ${point.maxMarks} marks`,
  }));
  const mean = average(plotted.map((point) => point.value));

  return {
    title: ranked ? 'Percentile' : 'Score',
    suffix: ranked ? '' : '%',
    points: plotted,
    band: ranked ? { ...TOP_QUARTER } : undefined,
    reference: mean === null ? undefined : { value: mean, label: 'Your average' },
  };
}

/** Null-safe because an unranked sitting has no percentile, and a mean of nothing is not zero. */
function average(values: readonly (number | null)[]): number | null {
  const held = values.filter((value) => value !== null);
  if (held.length === 0) return null;
  return Math.round(held.reduce((sum, value) => sum + value, 0) / held.length);
}
