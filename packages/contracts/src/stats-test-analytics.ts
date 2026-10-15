import { z } from 'zod';
import { cohortBandSchema } from './stats-performance';
import { optionShareSchema } from './stats-question-report';

// ============================================================================
// The test's own view of its cohort: the spread counted live off its ranked
// sittings, and the time, sections and items read off the rollups the sweep
// recounts. Only graded sittings are in either, so every figure below
// describes the ranked cohort by construction.
// ============================================================================

/** Who topped the paper: the board's rank 1, counted live. Null until a sitting is ranked. */
const testTopperSchema = z.object({
  attemptId: z.string(),
  studentId: z.string(),
  name: z.string(),
  score: z.number().nullable(),
  timeSpentSec: z.number().int().nullable(),
});
export type TestTopper = z.infer<typeof testTopperSchema>;

export const testAnalyticsSummarySchema = z.object({
  /** Everyone its series reaches — the denominator `attemptCount` is a turnout against. */
  reachedCount: z.number().int(),
  /** Every sitting, ranked or not. `liveEvaluatedCount` is the cohort the spread describes. */
  attemptCount: z.number().int(),
  evaluatedCount: z.number().int(),
  meanScore: z.number().nullable(),
  /** Interpolated inside the band holding the middle sitting — never an exact order statistic. */
  medianScore: z.number().nullable(),
  maxScore: z.number().nullable(),
  minScore: z.number().nullable(),
  averageTimeSec: z.number().nullable(),
  /** Counted live off the ranked sittings. Empty means nobody is ranked yet, not a flat curve. */
  bands: z.array(cohortBandSchema),
  topper: testTopperSchema.nullable(),
  computedAt: z.string().nullable(),
  /** Counted live off the attempts, where `evaluatedCount` is what the fold has reached so far. */
  liveEvaluatedCount: z.number().int(),
  /** The fold is behind the sittings: the figures above are about to move. */
  isSettling: z.boolean(),
});
export type TestAnalyticsSummary = z.infer<typeof testAnalyticsSummarySchema>;

export const testSectionAnalyticsSchema = z.object({
  baseConfigSectionId: z.string(),
  name: z.string(),
  order: z.number().int(),
  /** What the section was out of, so two sections of different sizes are read on one scale. */
  maxMarks: z.number(),
  attempted: z.number().int(),
  averageScore: z.number().nullable(),
  averageTimeSec: z.number().nullable(),
});
export type TestSectionAnalytics = z.infer<typeof testSectionAnalyticsSchema>;

/** What a single item can trip. Each is read off the rollup's own columns, never recomputed. */
export const ITEM_SIGNALS = {
  LOW_ACCURACY: 'LOW_ACCURACY',
  HIGH_SKIP: 'HIGH_SKIP',
  SLOW: 'SLOW',
} as const;
const itemSignalSchema = z.enum(ITEM_SIGNALS);
export type ItemSignal = z.infer<typeof itemSignalSchema>;

export const testItemAnalyticsSchema = z.object({
  paperQuestionId: z.string(),
  questionId: z.string(),
  order: z.number().int(),
  baseConfigSectionId: z.string(),
  questionCode: z.string().nullable(),
  stemPreview: z.string(),
  attemptedCount: z.number().int(),
  correctCount: z.number().int(),
  wrongCount: z.number().int(),
  skippedCount: z.number().int(),
  averageTimeSec: z.number().nullable(),
  pValue: z.number().nullable(),
  /** Null wherever the fold has not written it; the item signals stand without it. */
  optionCounts: z.array(optionShareSchema),
  signals: z.array(itemSignalSchema),
});
export type TestItemAnalytics = z.infer<typeof testItemAnalyticsSchema>;

export const testAnalyticsSchema = z.object({
  testId: z.string(),
  title: z.string().nullable(),
  summary: testAnalyticsSummarySchema,
  sections: z.array(testSectionAnalyticsSchema),
  items: z.array(testItemAnalyticsSchema),
});
export type TestAnalytics = z.infer<typeof testAnalyticsSchema>;

/** At four options this is chance, so below it the cohort was guessing rather than answering. */
const LOW_ACCURACY_BELOW = 0.25;

/** Left blank by more of the field than answered it. */
const HIGH_SKIP_ABOVE = 0.5;

/** Against the paper's own per-question average, so a slow PAPER does not flag every item on it. */
const SLOW_ITEM_MULTIPLE = 2;

/** Below this many sittings on the item, the counts are too thin to read a signal off at all. */
export const ITEM_SIGNAL_FLOOR = 10;

/** One signal is a property of the question; two is a question worth a person opening it. */
const INSPECT_AT_LEAST = 2;

export type ItemCounts = Pick<
  TestItemAnalytics,
  'attemptedCount' | 'skippedCount' | 'pValue' | 'averageTimeSec'
>;

/** Every signal an item trips, off the columns the fold already wrote. */
export function itemSignalsOf(item: ItemCounts, paperAverageTimeSec: number | null): ItemSignal[] {
  const sat = item.attemptedCount + item.skippedCount;
  if (sat < ITEM_SIGNAL_FLOOR) return [];

  const slowerThan = paperAverageTimeSec === null ? null : paperAverageTimeSec * SLOW_ITEM_MULTIPLE;
  const tripped: (ItemSignal | null)[] = [
    item.pValue !== null && item.pValue < LOW_ACCURACY_BELOW ? ITEM_SIGNALS.LOW_ACCURACY : null,
    item.skippedCount / sat > HIGH_SKIP_ABOVE ? ITEM_SIGNALS.HIGH_SKIP : null,
    slowerThan !== null && item.averageTimeSec !== null && item.averageTimeSec > slowerThan
      ? ITEM_SIGNALS.SLOW
      : null,
  ];
  return tripped.filter((signal): signal is ItemSignal => signal !== null);
}

/** The flag itself: enough signals at once that the item, not the cohort, is the likely fault. */
export const worthInspecting = (item: Pick<TestItemAnalytics, 'signals'>): boolean =>
  item.signals.length >= INSPECT_AT_LEAST;
