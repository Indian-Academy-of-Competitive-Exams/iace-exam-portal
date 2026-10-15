import { z } from 'zod';
import { instituteDayLabel } from './common';
import { scoreCardSectionSchema, timeUseSchema, type PerformancePoint } from './attempts';
import { round2, type Disposition } from './stats';

// ============================================================================
// The performance report: ONE metric set, parameterised by (student, scope).
// Cutoff-free on purpose — a cutoff is a rumour about a future exam, while a
// percentile is a fact about the cohort that sat this one. Marks are never
// compared across papers; percentile is.
// ============================================================================

/** What a report is asked about: one sitting, or a whole career. */
export const PERFORMANCE_SCOPES = {
  ATTEMPT: 'ATTEMPT',
  ALL_TIME: 'ALL_TIME',
} as const;
const performanceScopeSchema = z.enum(PERFORMANCE_SCOPES);
export type PerformanceScope = z.infer<typeof performanceScopeSchema>;

/** Which id each scope is answered by. ALL_TIME needs none — the student IS the scope. */
export const PERFORMANCE_SCOPE_FIELD = {
  [PERFORMANCE_SCOPES.ATTEMPT]: 'attemptId',
  [PERFORMANCE_SCOPES.ALL_TIME]: null,
} as const satisfies Record<PerformanceScope, string | null>;

export const performanceReportQuerySchema = z
  .object({
    scope: performanceScopeSchema,
    attemptId: z.string().min(1).optional(),
  })
  .superRefine((query, ctx) => {
    const field = PERFORMANCE_SCOPE_FIELD[query.scope];
    if (field !== null && query[field] === undefined) {
      ctx.addIssue({ code: 'custom', path: [field], message: `${query.scope} needs a ${field}` });
    }
  });
export type PerformanceReportQuery = z.infer<typeof performanceReportQuerySchema>;
export type PerformanceReportQueryInput = z.input<typeof performanceReportQuerySchema>;

/** A share as a reader says it: the server keeps 2dp for averaging, a screen shows neither. */
export const percentLabel = (value: number | null, empty = '\u2014'): string =>
  value === null ? empty : `${Math.round(value)}%`;

/** A slice with its own n; `accuracy` is NULL when nothing was attempted, never 0. */
/** One point on the trajectory. Percentile, never marks: two papers are not the same paper. */
const percentilePointSchema = z.object({
  attemptId: z.string(),
  testId: z.string(),
  testTitle: z.string().nullable(),
  submittedAt: z.string().nullable(),
  percentile: z.number().nullable(),
  rank: z.number().int().nullable(),
  /** The n behind the percentile: its live cohort where ranked, else the rollup's, else null. */
  cohortSize: z.number().int().nullable(),
});
export type PercentilePoint = z.infer<typeof percentilePointSchema>;

/** Where a score falls between the floor and the top of what the paper was actually scored. */
export function placeInSpread(
  score: number,
  lowest: number | null,
  topper: number | null,
): number | null {
  if (lowest === null || topper === null || topper <= lowest) return null;
  const share = ((score - lowest) / (topper - lowest)) * 100;
  return round2(Math.min(100, Math.max(0, share)));
}

/** One column of the cohort's score distribution: `from` inclusive, `to` exclusive. */
export const cohortBandSchema = z.object({
  from: z.number(),
  to: z.number(),
  count: z.number().int(),
});
export type CohortBand = z.infer<typeof cohortBandSchema>;

// ============================================================================
// The banding convention `cohortShapeOf` implements, the one producer left
// now that no rollup column stores a curve:
//
//   Ascending by `from`, contiguous, equal integer widths. `from` is inclusive
//   and `to` exclusive, except on the last band, which owns its top edge.
//   Bands span floor(lowest score) .. ceil(highest score) — negative marking
//   puts the floor below zero — in ~10 columns, each ceil(span / 10) wide and
//   never narrower than 1. A score off either end takes the nearest end band.
// ============================================================================

const cohortCurveBandSchema = cohortBandSchema.extend({
  /** True on exactly one band: the one holding this score, or the end band nearest it. */
  isYours: z.boolean(),
});
export type CohortCurveBand = z.infer<typeof cohortCurveBandSchema>;

/** Where this student sits on the curve the cohort drew. Only a single paper has one. */
const cohortCurveSchema = z.object({
  testId: z.string(),
  score: z.number(),
  topperScore: z.number().nullable(),
  averageScore: z.number().nullable(),
  rank: z.number().int().nullable(),
  percentile: z.number().nullable(),
  cohortSize: z.number().int(),
  /** The rollup's histogram where one is written, else counted off the sittings; empty means none. */
  bands: z.array(cohortCurveBandSchema),
});
export type CohortCurve = z.infer<typeof cohortCurveSchema>;

/** Where marks came from and leaked, in MARKS; the three partition `maxMarks`. */
const markCompositionSchema = z.object({
  maxMarks: z.number(),
  earned: z.number(),
  /** Forgone on questions the key marked wrong. */
  lostToWrong: z.number(),
  /** Forgone on questions that were never marked right or wrong. */
  lostToUnanswered: z.number(),
  /** What negative marking took back, summed from `PaperQuestion.negativeMarks`. Positive. */
  penalty: z.number(),
  /** `earned - penalty` — the marks the paper actually paid out. */
  net: z.number(),
});
export type MarkComposition = z.infer<typeof markCompositionSchema>;

/** One section, this student's against the cohort's mean — and the n that mean is over. */
const sectionalStandingSchema = scoreCardSectionSchema.extend({
  cohortAverageScore: z.number().nullable(),
  cohortAverageTimeSec: z.number().nullable(),
  /** Sittings behind those two averages. Zero means no rollup, not an empty section. */
  cohortSampleSize: z.number().int(),
  /** What the paper's topper spent here. Time is not answer-key, so it needs no gate. */
  topperTimeSec: z.number().int().nullable(),
  // Rank WITHIN a subject is deliberately absent: per-subject cohort ranking is its own pass.
});
export type SectionalStanding = z.infer<typeof sectionalStandingSchema>;

/** One sitting against its paper's cohort: a report's anchor, and the body of a score card. */
const sittingFiguresSchema = z.object({
  /** This paper's clock against the cohort's average: above 1 is slower, below 1 faster. */
  paceIndex: z.number().nullable(),
  /** Null wherever the scope spans more than one paper — marks do not compare across papers. */
  cohort: cohortCurveSchema.nullable(),
  /** The ANCHOR sitting, like everything below it: marks summed across papers are not a paper. */
  composition: markCompositionSchema,
  sections: z.array(sectionalStandingSchema),
  time: timeUseSchema,
});

/** Never carries a question, an option or an answer key — at any scope, on either path. */
export const performanceReportSchema = sittingFiguresSchema.extend({
  studentId: z.string(),
  scope: performanceScopeSchema,
  /** The id the scope was asked about. Null for ALL_TIME. */
  scopeId: z.string().nullable(),
  label: z.string().nullable(),
  /** Evaluated sittings in scope — what the trajectory plots, and only that. */
  attemptsCounted: z.number().int(),
  generatedAt: z.string(),
  trajectory: z.array(percentilePointSchema),
});
export type PerformanceReport = z.infer<typeof performanceReportSchema>;

/** Every tab of one sitting's report reads this; like the report, it carries no question at all. */
export const scoreCardSchema = sittingFiguresSchema.extend({
  attemptId: z.string(),
  testId: z.string(),
  testTitle: z.string().nullable(),
  attemptNo: z.number().int(),
  /** False for a retake: it is marked, but it is not in the ranking. */
  isGraded: z.boolean(),
  submittedAt: z.string().nullable(),
  evaluatedAt: z.string().nullable(),
  score: z.number(),
  maxMarks: z.number(),
  percentage: z.number(),
  correctCount: z.number().int(),
  wrongCount: z.number().int(),
  unattemptedCount: z.number().int(),
  totalQuestions: z.number().int(),
  timeTakenSec: z.number().int(),
  durationSec: z.number().int(),
  /** Live from the ranking. Null for a retake, and while a wiped board is being put back. */
  rank: z.number().int().nullable(),
  percentile: z.number().nullable(),
  cohortSize: z.number().int().nullable(),
  /** The paper has a section of written answers, which were marked by rule and not by an examiner. */
  hasWritten: z.boolean().optional(),
});
export type ScoreCard = z.infer<typeof scoreCardSchema>;

// ============================================================================
// Reading a trend the way the Performance screen has to: which papers were sat,
// which sittings belong to one of them, and which of those went best. Marks are
// only ever compared WITHIN a test here — across papers they mean nothing.
// ============================================================================

/** A sitting a student's report can open on, and whether it holds the ranked slot. */
export const reportSittingSchema = z.object({
  attemptId: z.string(),
  testTitle: z.string().nullable(),
  submittedAt: z.string().nullable(),
  isGraded: z.boolean(),
});
export type ReportSitting = z.infer<typeof reportSittingSchema>;

/** How a sitting is named wherever one is picked: the paper, and the day it was sat. */
export function sittingLabel(sitting: Pick<ReportSitting, 'testTitle' | 'submittedAt'>): string {
  const day = instituteDayLabel(sitting.submittedAt);
  const title = sitting.testTitle ?? 'Untitled test';
  return day === null ? title : `${title} · ${day}`;
}

/** One paper a student has sat, and the sitting that dates it. */
export interface SatTest {
  testId: string;
  title: string | null;
  /** The most recent sitting of it — what the picker orders by and defaults to. */
  lastAttemptId: string;
  lastSatAt: string | null;
}

/** Distinct papers behind a trend, most recently sat first. Takes the trend oldest-first. */
export function testsSat(points: readonly PerformancePoint[]): SatTest[] {
  const seen = new Map<string, SatTest>();
  for (const point of [...points].reverse()) {
    if (seen.has(point.testId)) continue;
    seen.set(point.testId, {
      testId: point.testId,
      title: point.testTitle,
      lastAttemptId: point.attemptId,
      lastSatAt: point.submittedAt,
    });
  }
  return [...seen.values()];
}

/** The anchor's own denominator, summed off its sections so every figure shares one paper. */
export function paperCounts(sections: readonly SectionalStanding[]): Disposition {
  return sections.reduce<Disposition>(
    (total, section) => ({
      correct: total.correct + section.correctCount,
      wrong: total.wrong + section.wrongCount,
      unattempted: total.unattempted + section.unattemptedCount,
    }),
    { correct: 0, wrong: 0, unattempted: 0 },
  );
}

/** The best-scoring sitting in a set. A tie goes to the earliest: that is when it was reached. */
export function bestSitting(points: readonly PerformancePoint[]): PerformancePoint | null {
  return points.reduce<PerformancePoint | null>(
    (best, point) => (best === null || point.score > best.score ? point : best),
    null,
  );
}

export const PERFORMANCE_ROUTES = {
  ofStudent: (studentId: string) => `/admin/students/${studentId}/performance`,
} as const;
