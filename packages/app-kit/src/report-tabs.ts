/**
 * The per-test Report's tabs, and the two orderings a shell around them depends on. Both apps read
 * one sitting the same way, and the trend they read it from is oldest-first — which is the line a
 * chart draws and the reverse of what a picker offers.
 */

/** In the order a student reads them: their marks, then why, then who else sat it. */
export const REPORT_TABS = [
  { path: '', label: 'Score card' },
  { path: 'subjects', label: 'Subject report' },
  { path: 'solutions', label: 'Solution report' },
  { path: 'questions', label: 'Question report' },
  { path: 'compare', label: 'Compare' },
] as const;

export type ReportTab = (typeof REPORT_TABS)[number]['path'];

const SCORE_CARD: ReportTab = '';

/** The PATH decides the tab, so a reload or a pasted link opens where it says it will. */
export function reportTabOf(pathname: string, base: string): ReportTab {
  if (!pathname.startsWith(base)) return SCORE_CARD;
  const rest = pathname.slice(base.length).split('/').filter(Boolean).join('/');
  const held = REPORT_TABS.find((tab) => tab.path === rest);
  return held?.path ?? SCORE_CARD;
}

/** The most recent sitting, from a trend that runs oldest to newest. Null when nothing was sat. */
export function latestSitting<T>(points: readonly T[]): T | null {
  return points.at(-1) ?? null;
}

/** A picker offers the newest first; the trend that feeds it is ordered for a chart. */
export function newestFirst<T>(points: readonly T[]): T[] {
  return [...points].reverse();
}
