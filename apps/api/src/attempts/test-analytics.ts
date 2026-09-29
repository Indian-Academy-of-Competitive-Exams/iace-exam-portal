/**
 * The rollup rows a test folded, and its live curve, turned into the admin's read of them. Sums and
 * counts go in, averages come out — the same derivation the student report does for one row, done
 * for the paper. Nothing in here reaches a database.
 */
import {
  itemSignalsOf,
  medianInBands,
  type QuestionOption,
  type TestAnalyticsSummary,
  type TestItemAnalytics,
  type TestSectionAnalytics,
  type TestTopper,
} from '@iace/contracts';
import { perSitting } from './attempt-report';
import { type CohortShape } from './performance-analytics';
import { sharesOf } from './question-report';

export interface StatTotals {
  evaluatedCount: number;
  sumTimeSec: number;
  computedAt: Date;
}

export interface SectionTotals {
  baseConfigSectionId: string;
  name: string;
  order: number;
  maxMarks: number;
  attempted: number;
  sumScore: number;
  sumTimeSec: number;
}

export interface ItemTotals {
  paperQuestionId: string;
  questionId: string;
  order: number;
  baseConfigSectionId: string;
  questionCode: string | null;
  stemPreview: string;
  attemptedCount: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  sumTimeSec: number;
  pValue: number | null;
  options: readonly QuestionOption[];
  optionCounts: Record<string, number>;
}

const EMPTY_SUMMARY: TestAnalyticsSummary = {
  reachedCount: 0,
  attemptCount: 0,
  evaluatedCount: 0,
  meanScore: null,
  medianScore: null,
  maxScore: null,
  minScore: null,
  averageTimeSec: null,
  bands: [],
  topper: null,
  computedAt: null,
  liveEvaluatedCount: 0,
  isSettling: false,
};

export function summaryOf(
  stat: StatTotals | null,
  live: CohortShape,
  topper: TestTopper | null,
  counts: { attemptCount: number; reachedCount: number },
): TestAnalyticsSummary {
  const freshness = {
    ...counts,
    liveEvaluatedCount: live.size,
    isSettling: live.size !== (stat?.evaluatedCount ?? 0),
  };
  if (stat === null) return { ...EMPTY_SUMMARY, ...freshness };
  return {
    ...freshness,
    evaluatedCount: stat.evaluatedCount,
    meanScore: live.averageScore,
    medianScore: medianInBands(live.bands),
    maxScore: live.topperScore,
    minScore: live.lowestScore,
    averageTimeSec: perSitting(stat.sumTimeSec, stat.evaluatedCount),
    bands: live.bands,
    topper,
    computedAt: stat.computedAt.toISOString(),
  };
}

export function sectionsOf(rows: readonly SectionTotals[]): TestSectionAnalytics[] {
  return [...rows]
    .sort((a, b) => a.order - b.order)
    .map(({ sumScore, sumTimeSec, ...row }) => ({
      ...row,
      averageScore: perSitting(sumScore, row.attempted),
      averageTimeSec: perSitting(sumTimeSec, row.attempted),
    }));
}

/** Ordered as the paper is, because that is the order a person reads the questions back in. */
export function itemsOf(rows: readonly ItemTotals[]): TestItemAnalytics[] {
  const paperAverage = paperAverageTimeOf(rows);
  return [...rows]
    .sort((a, b) => a.order - b.order)
    .map(({ sumTimeSec, options, optionCounts, ...row }) => {
      const averageTimeSec = perSitting(sumTimeSec, row.attemptedCount);
      return {
        ...row,
        averageTimeSec,
        optionCounts: sharesOf(options, optionCounts),
        signals: itemSignalsOf({ ...row, averageTimeSec }, paperAverage),
      };
    });
}

/** What one question cost the average sitting on THIS paper, which is what "slow" is read against. */
function paperAverageTimeOf(rows: readonly ItemTotals[]): number | null {
  const attempted = rows.reduce((total, row) => total + row.attemptedCount, 0);
  const spent = rows.reduce((total, row) => total + row.sumTimeSec, 0);
  return perSitting(spent, attempted);
}
