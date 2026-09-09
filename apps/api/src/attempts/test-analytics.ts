/**
 * The rollup rows a test folded, turned into the admin's read of them. Sums and counts go in,
 * averages come out — the same derivation the student report does for one row, done for the paper.
 * Nothing in here reaches a database, and nothing needs an attempt.
 */
import {
  itemSignalsOf,
  medianInBands,
  type CohortBand,
  type OptionShare,
  type QuestionOption,
  type TestAnalyticsSummary,
  type TestItemAnalytics,
  type TestSectionAnalytics,
  type TestTopper,
} from '@iace/contracts';

export interface StatTotals {
  attemptCount: number;
  evaluatedCount: number;
  sumScore: number;
  maxScore: number | null;
  minScore: number | null;
  sumTimeSec: number;
  bands: CohortBand[];
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
  discrimination: number | null;
  options: readonly QuestionOption[];
  optionCounts: Record<string, number>;
}

const EMPTY_SUMMARY: TestAnalyticsSummary = {
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
};

const SCORE_PLACES = 2;

export function summaryOf(
  stat: StatTotals | null,
  topper: TestTopper | null,
): TestAnalyticsSummary {
  if (stat === null) return EMPTY_SUMMARY;
  return {
    attemptCount: stat.attemptCount,
    evaluatedCount: stat.evaluatedCount,
    meanScore: perSitting(stat.sumScore, stat.evaluatedCount),
    medianScore: medianInBands(stat.bands),
    maxScore: stat.maxScore,
    minScore: stat.minScore,
    averageTimeSec: perSitting(stat.sumTimeSec, stat.evaluatedCount),
    bands: stat.bands,
    topper,
    computedAt: stat.computedAt.toISOString(),
  };
}

export function sectionsOf(rows: readonly SectionTotals[]): TestSectionAnalytics[] {
  return [...rows]
    .sort((a, b) => a.order - b.order)
    .map((row) => ({
      baseConfigSectionId: row.baseConfigSectionId,
      name: row.name,
      order: row.order,
      maxMarks: row.maxMarks,
      attempted: row.attempted,
      averageScore: perSitting(row.sumScore, row.attempted),
      averageTimeSec: perSitting(row.sumTimeSec, row.attempted),
    }));
}

/** Ordered as the paper is, because that is the order a person reads the questions back in. */
export function itemsOf(rows: readonly ItemTotals[]): TestItemAnalytics[] {
  const paperAverage = paperAverageTimeOf(rows);
  return [...rows]
    .sort((a, b) => a.order - b.order)
    .map((row) => {
      const averageTimeSec = perSitting(row.sumTimeSec, row.attemptedCount);
      const counts = {
        attemptedCount: row.attemptedCount,
        skippedCount: row.skippedCount,
        pValue: row.pValue,
        discrimination: row.discrimination,
        averageTimeSec,
      };
      return {
        paperQuestionId: row.paperQuestionId,
        questionId: row.questionId,
        order: row.order,
        baseConfigSectionId: row.baseConfigSectionId,
        questionCode: row.questionCode,
        stemPreview: row.stemPreview,
        attemptedCount: row.attemptedCount,
        correctCount: row.correctCount,
        wrongCount: row.wrongCount,
        skippedCount: row.skippedCount,
        averageTimeSec,
        pValue: row.pValue,
        discrimination: row.discrimination,
        optionCounts: sharesOf(row.options, row.optionCounts),
        signals: itemSignalsOf(counts, paperAverage),
      };
    });
}

/** What one question cost the average sitting on THIS paper, which is what "slow" is read against. */
function paperAverageTimeOf(rows: readonly ItemTotals[]): number | null {
  const attempted = rows.reduce((total, row) => total + row.attemptedCount, 0);
  const spent = rows.reduce((total, row) => total + row.sumTimeSec, 0);
  return perSitting(spent, attempted);
}

function sharesOf(
  options: readonly QuestionOption[],
  counts: Record<string, number>,
): OptionShare[] {
  return [...options]
    .sort((a, b) => a.position - b.position)
    .map((option) => ({
      optionId: option.id,
      position: option.position,
      count: counts[option.id] ?? 0,
      isCorrect: option.isCorrect === true,
    }));
}

/** Nothing counted is not a zero: an unfolded paper has no average, it does not average zero. */
function perSitting(total: number, sittings: number): number | null {
  if (sittings === 0) return null;
  const steps = 10 ** SCORE_PLACES;
  return Math.round((total / sittings) * steps) / steps;
}
