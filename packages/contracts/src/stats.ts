import { z } from 'zod';
import { evaluationModeSchema, testScopeSchema } from './tests';
import { analyticsBucketSchema, scoreCardSectionSchema, timeUseSchema } from './attempts';

// ============================================================================
// Analytics rollups. Pre-aggregated so the student dashboard and the admin test
// report are O(1) reads that never scan attempts. They store sums and counts;
// averages, accuracy and difficulty are derived when read.
//
// Live in-exam rank and percentile stay in Redis. These are the durable
// aggregates that outlive it.
// ============================================================================

/** One row per student — the dashboard header. */
export const studentStatSchema = z.object({
  studentId: z.string(),
  testsAttempted: z.number().int(),
  testsEvaluated: z.number().int(),
  /** Divide by testsEvaluated for the average. */
  sumScore: z.number(),
  sumPercentile: z.number(),
  bestPercentile: z.number().nullable(),
  totalAnswered: z.number().int(),
  totalCorrect: z.number().int(),
  totalWrong: z.number().int(),
  totalUnattempted: z.number().int(),
  sumTimeSec: z.number().int(),
  /** A count only. The detail lives in the per-subject buckets. */
  practiceAttempts: z.number().int(),
  lastAttemptAt: z.string().nullable(),
  computedAt: z.string(),
});
export type StudentStat = z.infer<typeof studentStatSchema>;

/**
 * The strength map, bucketed by kind of test so it can be filtered to full-length
 * or sectional, ranked or practice. Overall is the sum across buckets.
 */
export const studentSubjectStatSchema = z.object({
  studentId: z.string(),
  subjectId: z.string(),
  scope: testScopeSchema,
  evaluationMode: evaluationModeSchema,
  attempted: z.number().int(),
  correct: z.number().int(),
  wrong: z.number().int(),
  sumTimeSec: z.number().int(),
  computedAt: z.string(),
});
export type StudentSubjectStat = z.infer<typeof studentSubjectStatSchema>;

/** One row per test — the cohort aggregate behind the admin report. */
export const testStatSchema = z.object({
  testId: z.string(),
  attemptCount: z.number().int(),
  /** The denominator for every average here. */
  evaluatedCount: z.number().int(),
  sumScore: z.number(),
  maxScore: z.number().nullable(),
  minScore: z.number().nullable(),
  sumTimeSec: z.number().int(),
  topperAttemptId: z.string().nullable(),
  computedAt: z.string(),
});
export type TestStat = z.infer<typeof testStatSchema>;

export const testSectionStatSchema = z.object({
  testId: z.string(),
  baseConfigSectionId: z.string(),
  attempted: z.number().int(),
  sumScore: z.number(),
  sumTimeSec: z.number().int(),
  computedAt: z.string(),
});
export type TestSectionStat = z.infer<typeof testSectionStatSchema>;

/** Item analysis for a frozen paper: how each question behaved, and which distractor pulled. */
export const testQuestionStatSchema = z.object({
  testId: z.string(),
  paperQuestionId: z.string(),
  questionId: z.string(),
  attemptedCount: z.number().int(),
  correctCount: z.number().int(),
  wrongCount: z.number().int(),
  /** Visited and left unanswered, which is not the same as never reached. */
  skippedCount: z.number().int(),
  sumTimeSec: z.number().int(),
  /** Difficulty index — correct over attempted. Recomputed in batch, never on read. */
  pValue: z.number().nullable(),
  discrimination: z.number().nullable(),
  computedAt: z.string(),
});
export type TestQuestionStat = z.infer<typeof testQuestionStatSchema>;

// ============================================================================
// The performance report: ONE metric set, parameterised by (student, scope).
// Cutoff-free on purpose — a cutoff is a rumour about a future exam, while a
// percentile is a fact about the cohort that sat this one. Marks are never
// compared across papers; percentile is.
// ============================================================================

/** What a report is asked about: one sitting, one paper, one series, or a whole career. */
export const PERFORMANCE_SCOPES = {
  ATTEMPT: 'ATTEMPT',
  TEST: 'TEST',
  SERIES: 'SERIES',
  ALL_TIME: 'ALL_TIME',
} as const;
export const performanceScopeSchema = z.enum(PERFORMANCE_SCOPES);
export type PerformanceScope = z.infer<typeof performanceScopeSchema>;
export const PERFORMANCE_SCOPE_VALUES = performanceScopeSchema.options;

/** Which id each scope is answered by. ALL_TIME needs none — the student IS the scope. */
export const PERFORMANCE_SCOPE_FIELD = {
  [PERFORMANCE_SCOPES.ATTEMPT]: 'attemptId',
  [PERFORMANCE_SCOPES.TEST]: 'testId',
  [PERFORMANCE_SCOPES.SERIES]: 'seriesId',
  [PERFORMANCE_SCOPES.ALL_TIME]: null,
} as const satisfies Record<PerformanceScope, string | null>;

export const performanceReportQuerySchema = z
  .object({
    scope: performanceScopeSchema,
    attemptId: z.string().min(1).optional(),
    testId: z.string().min(1).optional(),
    seriesId: z.string().min(1).optional(),
  })
  .superRefine((query, ctx) => {
    const field = PERFORMANCE_SCOPE_FIELD[query.scope];
    if (field !== null && query[field] === undefined) {
      ctx.addIssue({ code: 'custom', path: [field], message: `${query.scope} needs a ${field}` });
    }
  });
export type PerformanceReportQuery = z.infer<typeof performanceReportQuerySchema>;
export type PerformanceReportQueryInput = z.input<typeof performanceReportQuerySchema>;

/** A slice with its own n; `accuracy` is NULL when nothing was attempted, never 0. */
export const measuredBucketSchema = analyticsBucketSchema.extend({
  accuracy: z.number().nullable(),
});
export type MeasuredBucket = z.infer<typeof measuredBucketSchema>;

/** One point on the trajectory. Percentile, never marks: two papers are not the same paper. */
export const percentilePointSchema = z.object({
  attemptId: z.string(),
  testId: z.string(),
  testTitle: z.string().nullable(),
  submittedAt: z.string().nullable(),
  percentile: z.number().nullable(),
  rank: z.number().int().nullable(),
  /** The n behind the percentile. Null where no rollup has counted the cohort yet. */
  cohortSize: z.number().int().nullable(),
});
export type PercentilePoint = z.infer<typeof percentilePointSchema>;

/** One column of the cohort's score distribution: `from` inclusive, `to` exclusive. */
export const cohortBandSchema = z.object({
  from: z.number(),
  to: z.number(),
  count: z.number().int(),
});
export type CohortBand = z.infer<typeof cohortBandSchema>;

/** The shape `TestStat.scoreHistogram` holds. Read defensively — the column is free-form JSON. */
export const scoreHistogramSchema = z.array(cohortBandSchema);

export const cohortCurveBandSchema = cohortBandSchema.extend({
  /** True on the single band this student's score falls in. */
  isYours: z.boolean(),
});
export type CohortCurveBand = z.infer<typeof cohortCurveBandSchema>;

/** Where this student sits on the curve the cohort drew. Only a single paper has one. */
export const cohortCurveSchema = z.object({
  testId: z.string(),
  score: z.number(),
  topperScore: z.number().nullable(),
  averageScore: z.number().nullable(),
  rank: z.number().int().nullable(),
  percentile: z.number().nullable(),
  cohortSize: z.number().int(),
  /** Empty until a rollup writes a histogram. An empty curve is not a flat one. */
  bands: z.array(cohortCurveBandSchema),
});
export type CohortCurve = z.infer<typeof cohortCurveSchema>;

/** Where marks came from and leaked, in MARKS; the three partition `maxMarks`. */
export const markCompositionSchema = z.object({
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
export const sectionalStandingSchema = scoreCardSectionSchema.extend({
  cohortAverageScore: z.number().nullable(),
  cohortAverageTimeSec: z.number().nullable(),
  /** Sittings behind those two averages. Zero means no rollup, not an empty section. */
  cohortSampleSize: z.number().int(),
});
export type SectionalStanding = z.infer<typeof sectionalStandingSchema>;

/** A difficulty band crossed with how hard the COHORT found it — their label against the evidence. */
export const difficultyStandingSchema = measuredBucketSchema.extend({
  /** Mean `TestQuestionStat.pValue` over this band's questions — correct over attempted, cohort-wide. */
  cohortPValue: z.number().nullable(),
  /** Questions in the band the cohort has a p-value for. Zero means unmeasured, not easy. */
  cohortQuestionCount: z.number().int(),
});
export type DifficultyStanding = z.infer<typeof difficultyStandingSchema>;

/** Never carries a question, an option or an answer key — at any scope, on either path. */
export const performanceReportSchema = z.object({
  studentId: z.string(),
  scope: performanceScopeSchema,
  /** The id the scope was asked about. Null for ALL_TIME. */
  scopeId: z.string().nullable(),
  label: z.string().nullable(),
  /** Evaluated sittings every figure below is derived from. */
  attemptsCounted: z.number().int(),
  generatedAt: z.string(),
  trajectory: z.array(percentilePointSchema),
  /** Null wherever the scope spans more than one paper — marks do not compare across papers. */
  cohort: cohortCurveSchema.nullable(),
  composition: markCompositionSchema,
  sections: z.array(sectionalStandingSchema),
  difficulty: z.array(difficultyStandingSchema),
  time: timeUseSchema,
});
export type PerformanceReport = z.infer<typeof performanceReportSchema>;

export const PERFORMANCE_ROUTES = {
  me: '/me/performance/report',
  ofStudent: (studentId: string) => `/admin/students/${studentId}/performance`,
} as const;
