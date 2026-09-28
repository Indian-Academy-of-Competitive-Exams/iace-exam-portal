/** Where the phone's trend line breaks; what it plots is app-kit's `trendOf`. */
export interface TrendPoint {
  key: string;
  /** Null is nothing to plot, which is not zero — it draws no marker and breaks the line. */
  value: number | null;
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
