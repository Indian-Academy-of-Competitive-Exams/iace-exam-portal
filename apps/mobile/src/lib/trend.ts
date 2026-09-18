/** What the trend line is computed from: which figure it plots, and where it breaks. */
import { type PerformancePoint } from '@iace/contracts';

/** Where a percentile stops being a middle and starts being a placing worth chasing. */
export const TOP_QUARTER = { from: 75, to: 100, label: 'Top quarter' } as const;

export interface TrendPoint {
  key: string;
  /** Null is nothing to plot, which is not zero — it draws no marker and breaks the line. */
  value: number | null;
}

export interface Trendline {
  title: string;
  suffix: string;
  points: TrendPoint[];
  band?: { from: number; to: number; label: string };
  reference?: { value: number; label: string };
}

/** A percentile needs a marked ranked sitting; until there is one the same line reads the marks. */
export function trendOf(points: readonly PerformancePoint[]): Trendline | null {
  if (points.length < 2) return null;
  const ranked = points.some((point) => point.percentile !== null);

  const plotted = points.map((point) => ({
    key: point.attemptId,
    value: ranked ? point.percentile : point.percentage,
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

/** One path per unbroken run: joining across a null would draw a line through a sitting nobody ranked. */
export function plotRuns(points: readonly TrendPoint[]): number[][] {
  const runs: number[][] = [];
  let run: number[] = [];

  points.forEach((point, index) => {
    if (point.value === null) {
      if (run.length > 1) runs.push(run);
      run = [];
      return;
    }
    run.push(index);
  });
  if (run.length > 1) runs.push(run);

  return runs;
}

/** Null-safe because an unranked sitting has no percentile, and a mean of nothing is not zero. */
function average(values: readonly (number | null)[]): number | null {
  const held = values.filter((value) => value !== null);
  if (held.length === 0) return null;
  return Math.round(held.reduce((sum, value) => sum + value, 0) / held.length);
}
