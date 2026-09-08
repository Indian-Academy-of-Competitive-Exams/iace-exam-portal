import { z } from 'zod';
import { DIFFICULTY_LEVEL, difficultyLevelSchema, type DifficultyLevel } from './questions';
import {
  EVALUATION_MODE,
  TEST_SCOPES,
  evaluationModeSchema,
  paperQuestionStatusSchema,
  testScopeSchema,
  type EvaluationMode,
  type TestScope,
} from './tests';
import { todayISO } from './students';
import {
  analyticsBucketSchema,
  answerStateSchema,
  examSectionSchema,
  scoreCardSectionSchema,
  timeUseSchema,
  type PerformancePoint,
} from './attempts';

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

// ============================================================================
// The overall dashboard — the READ side of the two tables above, and the only
// one. It is sums and counts all the way down, so every average is derived here
// on the way out and nothing new is stored.
//
// The two tables answer different questions and must not be crossed:
// `StudentStat`'s totals count EVERY sitting, ranked and practice together, so
// only its ranked-gated fields (percentile, score, testsEvaluated) are safe to
// read per mode. Accuracy and pace per mode come from `StudentSubjectStat`,
// which keys on the mode. The disposition donut has no per-mode source at all —
// `StudentSubjectStat` never counted an unattempted question — so it stays
// lifetime and says so on screen.
// ============================================================================

/** Below this many questions a subject is a rumour, not a reading — every screen greys it. */
export const SUBJECT_SAMPLE_FLOOR = 20;

/** The ranked standing, off `StudentStat`. Every average is null at a zero denominator. */
export const overviewStandingSchema = z.object({
  /** Every folded sitting, ranked and practice — zero means nothing has been sat at all. */
  testsAttempted: z.number().int(),
  testsEvaluated: z.number().int(),
  practiceAttempts: z.number().int(),
  /** Provisional: each sitting's percentile was captured against the cohort of that moment. */
  avgPercentile: z.number().nullable(),
  bestPercentile: z.number().nullable(),
  avgScore: z.number().nullable(),
  /** Every sitting's clock, ranked and practice alike — the denominator of per-sitting effort. */
  sumTimeSec: z.number().int(),
  lastAttemptAt: z.string().nullable(),
});
export type OverviewStanding = z.infer<typeof overviewStandingSchema>;

/** LIFETIME, across ranked and practice alike: `StudentStat` is the only place these three live. */
export const dispositionSchema = z.object({
  correct: z.number().int(),
  wrong: z.number().int(),
  unattempted: z.number().int(),
});
export type Disposition = z.infer<typeof dispositionSchema>;

/** One `StudentSubjectStat` row as the dashboard reads it — counts only, no derived figure. */
export const subjectTallySchema = z.object({
  scope: testScopeSchema,
  evaluationMode: evaluationModeSchema,
  attempted: z.number().int(),
  correct: z.number().int(),
  sumTimeSec: z.number().int(),
});
export type SubjectTally = z.infer<typeof subjectTallySchema>;

/** A set of tallies summed to one reading. */
export const subjectMeasureSchema = z.object({
  attempted: z.number().int(),
  correct: z.number().int(),
  /** Percent. Null at a zero n — a zero would read as every answer wrong. */
  accuracy: z.number().nullable(),
  sumTimeSec: z.number().int(),
  /** Seconds per question ANSWERED, with the time spent on ones left blank folded into it. */
  pace: z.number().nullable(),
});
export type SubjectMeasure = z.infer<typeof subjectMeasureSchema>;

/** Self-referential on purpose: `StudentSubjectStat` holds no cohort, so there is no rank here. */
export const subjectStandingSchema = z.object({
  subjectId: z.string(),
  name: z.string(),
  /** One per (scope, mode) the student has sat, so a scope filter needs no second call. */
  tallies: z.array(subjectTallySchema),
});
export type SubjectStanding = z.infer<typeof subjectStandingSchema>;

export const modeMeasuresSchema = z.object({
  [EVALUATION_MODE.RANKED]: subjectMeasureSchema,
  [EVALUATION_MODE.PRACTICE]: subjectMeasureSchema,
});
export type ModeMeasures = z.infer<typeof modeMeasuresSchema>;

export const studentOverviewSchema = z.object({
  studentId: z.string(),
  generatedAt: z.string(),
  standing: overviewStandingSchema,
  /** Not toggle-bound: there is no per-mode unattempted anywhere to bind it to. */
  disposition: dispositionSchema,
  /** What the accuracy and pace tiles read, summed off the subject rows of each mode. */
  byMode: modeMeasuresSchema,
  subjects: z.array(subjectStandingSchema),
});
export type StudentOverview = z.infer<typeof studentOverviewSchema>;

/** The ONE way tallies become a reading; a null scope sums every one, which is the default. */
export function measureOf(
  tallies: readonly SubjectTally[],
  mode: EvaluationMode,
  scope: TestScope | null = null,
): SubjectMeasure {
  const counted = tallies.filter(
    (tally) => tally.evaluationMode === mode && (scope === null || tally.scope === scope),
  );
  const attempted = counted.reduce((sum, tally) => sum + tally.attempted, 0);
  const correct = counted.reduce((sum, tally) => sum + tally.correct, 0);
  const sumTimeSec = counted.reduce((sum, tally) => sum + tally.sumTimeSec, 0);

  return {
    attempted,
    correct,
    accuracy: attempted === 0 ? null : round2((correct / attempted) * 100),
    sumTimeSec,
    pace: attempted === 0 ? null : round2(sumTimeSec / attempted),
  };
}

/** A headline tile, whose value the screen renders — a dash for null is design, not contract. */
export interface StandingTile {
  key: string;
  label: string;
  value: number | null;
  /** The split behind the headline, where one number hides two. */
  foot?: string;
}

/** Percentile, score and marking need an evaluated RANKED sitting; practice answers differently. */
export function standingTiles(
  standing: OverviewStanding,
  measure: SubjectMeasure,
  mode: EvaluationMode,
): StandingTile[] {
  if (mode === EVALUATION_MODE.PRACTICE) {
    return [
      { key: 'sittings', label: 'Practice sittings', value: standing.practiceAttempts },
      { key: 'answered', label: 'Questions answered', value: measure.attempted },
      { key: 'correct', label: 'Correct', value: measure.correct },
    ];
  }

  return [
    { key: 'score', label: 'Average score', value: standing.avgScore },
    { key: 'marked', label: 'Tests marked', value: standing.testsEvaluated },
    // Sittings, not tests: `testsAttempted` counts every one, so six retakes of a paper are six.
    {
      key: 'sittings',
      label: 'Sittings',
      value: standing.testsAttempted,
      foot: standing.practiceAttempts > 0 ? `${standing.practiceAttempts} in practice` : undefined,
    },
  ];
}

// ============================================================================
// Practice days. A civil date, never an instant: a sitting submitted at 04:00
// IST belongs to that day, and `getUTC*` on the stored instant would put it on
// the one before. Every date here is a `YYYY-MM-DD` on the institute's clock.
// ============================================================================

/** One day on the calendar, and how many sittings landed on it. */
export const practiceDaySchema = z.object({
  date: z.string(),
  sittings: z.number().int(),
});
export type PracticeDay = z.infer<typeof practiceDaySchema>;
export const practiceDayListSchema = z.array(practiceDaySchema);

/** The window the SERVER chose, with the days inside it — the account decides how far back. */
export const practiceCalendarSchema = z.object({
  from: z.string(),
  days: practiceDayListSchema,
});
export type PracticeCalendar = z.infer<typeof practiceCalendarSchema>;

const DAY_MS = 86_400_000;

/** A civil date shifted by whole days. Safe on the string: a calendar date carries no zone. */
export function shiftCivilDate(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00.000Z`);
  return new Date(at.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** The first day of the month before this one — where "this month and last" starts. */
export function startOfLastMonth(today: string = todayISO()): string {
  const [year, month] = today.split('-').map(Number);
  const back = (month ?? 1) === 1;
  const at = back
    ? `${(year ?? 0) - 1}-12`
    : `${year}-${String((month ?? 1) - 1).padStart(2, '0')}`;
  return `${at}-01`;
}

/** Every day from `from` to `today` inclusive, oldest first, zeros filled in. */
export function practiceWindow(
  sat: readonly PracticeDay[],
  from: string,
  today: string = todayISO(),
): PracticeDay[] {
  const counted = new Map(sat.map((day) => [day.date, day.sittings]));
  const days: PracticeDay[] = [];
  for (let date = from; date <= today; date = shiftCivilDate(date, 1)) {
    days.push({ date, sittings: counted.get(date) ?? 0 });
  }
  return days;
}

/** Consecutive days ending today, or yesterday: a day still in progress cannot break a run. */
export function currentStreak(sat: readonly PracticeDay[], today: string = todayISO()): number {
  const days = daysWithSittings(sat);
  let day = days.has(today) ? today : shiftCivilDate(today, -1);
  let run = 0;
  while (days.has(day)) {
    run += 1;
    day = shiftCivilDate(day, -1);
  }
  return run;
}

/** The longest run anywhere in what was counted — the best they have ever kept up. */
export function longestStreak(sat: readonly PracticeDay[]): number {
  const days = daysWithSittings(sat);
  let best = 0;
  for (const day of days) {
    if (days.has(shiftCivilDate(day, -1))) continue;
    let run = 0;
    for (let at = day; days.has(at); at = shiftCivilDate(at, 1)) run += 1;
    best = Math.max(best, run);
  }
  return best;
}

const daysWithSittings = (sat: readonly PracticeDay[]) =>
  new Set(sat.filter((day) => day.sittings > 0).map((day) => day.date));

/** The three shares the disposition can answer. LIFETIME: it never split ranked from practice. */
export interface DispositionRates {
  served: number;
  answered: number;
  /** Of everything served, the share actually answered — a finishing problem shows up here first. */
  attemptRate: number | null;
  accuracy: number | null;
  /** Of what was answered, the share that was wrong. Negative marking makes this the costly one. */
  errorRate: number | null;
}

export function dispositionRates(disposition: Disposition): DispositionRates {
  const answered = disposition.correct + disposition.wrong;
  const served = answered + disposition.unattempted;

  return {
    served,
    answered,
    attemptRate: served === 0 ? null : round2((answered / served) * 100),
    accuracy: answered === 0 ? null : round2((disposition.correct / answered) * 100),
    errorRate: answered === 0 ? null : round2((disposition.wrong / answered) * 100),
  };
}

/** What one sitting costs on average — the effort figures a lifetime total cannot say on its own. */
export interface EffortPerSitting {
  questions: number | null;
  timeSec: number | null;
  /** Over everything SERVED, not everything answered — the pace a whole paper is finished at. */
  perServedSec: number | null;
}

export function effortPerSitting(
  standing: OverviewStanding,
  disposition: Disposition,
): EffortPerSitting {
  const sittings = standing.testsAttempted;
  if (sittings === 0) return { questions: null, timeSec: null, perServedSec: null };
  const served = disposition.correct + disposition.wrong + disposition.unattempted;

  return {
    questions: Math.round(served / sittings),
    timeSec: Math.round(standing.sumTimeSec / sittings),
    perServedSec: served === 0 ? null : round2(standing.sumTimeSec / served),
  };
}

/** One subject read in BOTH modes: whether it survives the paper that counts is the whole point. */
export interface SubjectModeGap {
  subjectId: string;
  name: string;
  ranked: SubjectMeasure;
  practice: SubjectMeasure;
  /** Ranked minus practice. Null unless BOTH sides were measured — a gap needs two ends. */
  accuracyGap: number | null;
  paceGap: number | null;
}

export function subjectModeGaps(
  subjects: readonly SubjectStanding[],
  scope: TestScope | null = null,
): SubjectModeGap[] {
  return subjects
    .map((subject) => {
      const ranked = measureOf(subject.tallies, EVALUATION_MODE.RANKED, scope);
      const practice = measureOf(subject.tallies, EVALUATION_MODE.PRACTICE, scope);
      return {
        subjectId: subject.subjectId,
        name: subject.name,
        ranked,
        practice,
        accuracyGap: gapBetween(ranked.accuracy, practice.accuracy),
        paceGap: gapBetween(ranked.pace, practice.pace),
      };
    })
    .filter((gap) => gap.accuracyGap !== null || gap.paceGap !== null);
}

/** Where the hours went against what they bought back, each as a share of the mode's own total. */
export interface SubjectShare {
  subjectId: string;
  name: string;
  attempted: number;
  correct: number;
  sumTimeSec: number;
  /** Of everything answered in this mode, the share this subject took. */
  attemptedShare: number;
  timeShare: number;
  correctShare: number;
  /** Correct share minus time share: above zero the subject is paying for the clock it takes. */
  payoff: number;
}

export function subjectShares(
  subjects: readonly SubjectStanding[],
  mode: EvaluationMode,
  scope: TestScope | null = null,
): SubjectShare[] {
  const measured = subjects
    .map((subject) => ({ subject, measure: measureOf(subject.tallies, mode, scope) }))
    .filter((row) => row.measure.attempted > 0);

  const totalTime = measured.reduce((sum, row) => sum + row.measure.sumTimeSec, 0);
  const totalCorrect = measured.reduce((sum, row) => sum + row.measure.correct, 0);
  const totalAttempted = measured.reduce((sum, row) => sum + row.measure.attempted, 0);

  return measured.map(({ subject, measure }) => {
    const timeShare = totalTime === 0 ? 0 : round2((measure.sumTimeSec / totalTime) * 100);
    const correctShare = totalCorrect === 0 ? 0 : round2((measure.correct / totalCorrect) * 100);
    return {
      subjectId: subject.subjectId,
      name: subject.name,
      attempted: measure.attempted,
      correct: measure.correct,
      sumTimeSec: measure.sumTimeSec,
      attemptedShare: totalAttempted === 0 ? 0 : round2((measure.attempted / totalAttempted) * 100),
      timeShare,
      correctShare,
      payoff: round2(correctShare - timeShare),
    };
  });
}

/** Served and never answered — the rows every other figure filters out, which is what hides them. */
export function untouchedSubjects(
  subjects: readonly SubjectStanding[],
  mode: EvaluationMode,
  scope: TestScope | null = null,
): SubjectStanding[] {
  return subjects.filter((subject) => {
    const served = subject.tallies.some(
      (tally) => tally.evaluationMode === mode && (scope === null || tally.scope === scope),
    );
    return served && measureOf(subject.tallies, mode, scope).attempted === 0;
  });
}

/** The kinds of paper this mode has never asked for. The enum IS the catalogue; nothing to fetch. */
export const scopesNotSat = (
  subjects: readonly SubjectStanding[],
  mode: EvaluationMode,
): TestScope[] => {
  const sat = new Set(scopesSat(subjects, mode));
  return TEST_SCOPES.filter((scope) => !sat.has(scope));
};

/** Two scopes set against each other, per subject: whether a full paper holds what a short one showed. */
export interface ScopeComparison {
  first: TestScope;
  second: TestScope;
  subjects: {
    subjectId: string;
    name: string;
    first: SubjectMeasure;
    second: SubjectMeasure;
    accuracyGap: number | null;
  }[];
}

/** The two scopes this mode has the most behind it — a comparison needs volume on both sides. */
export function scopeComparison(
  subjects: readonly SubjectStanding[],
  mode: EvaluationMode,
): ScopeComparison | null {
  const busiest = volumeByScope(subjects, mode)
    .filter((row) => row.attempted > 0)
    .sort((a, b) => b.attempted - a.attempted);
  const first = busiest[0]?.scope;
  const second = busiest[1]?.scope;
  if (first === undefined || second === undefined) return null;
  const compared = subjects
    .map((subject) => {
      const one = measureOf(subject.tallies, mode, first);
      const two = measureOf(subject.tallies, mode, second);
      return {
        subjectId: subject.subjectId,
        name: subject.name,
        first: one,
        second: two,
        accuracyGap: gapBetween(one.accuracy, two.accuracy),
      };
    })
    .filter((row) => row.accuracyGap !== null);

  return compared.length === 0 ? null : { first, second, subjects: compared };
}

/** How much of each kind of paper has been sat in this mode. A scope missing here is a blind spot. */
export function volumeByScope(
  subjects: readonly SubjectStanding[],
  mode: EvaluationMode,
): { scope: TestScope; attempted: number }[] {
  return TEST_SCOPES.map((scope) => ({
    scope,
    attempted: subjects.reduce(
      (sum, subject) => sum + measureOf(subject.tallies, mode, scope).attempted,
      0,
    ),
  }));
}

/** The same gap over every subject at once: how the whole reader changes when the paper counts. */
export function overallModeGap(
  subjects: readonly SubjectStanding[],
  scope: TestScope | null = null,
) {
  const tallies = subjects.flatMap((subject) => subject.tallies);
  const ranked = measureOf(tallies, EVALUATION_MODE.RANKED, scope);
  const practice = measureOf(tallies, EVALUATION_MODE.PRACTICE, scope);

  return {
    ranked,
    practice,
    accuracyGap: gapBetween(ranked.accuracy, practice.accuracy),
    paceGap: gapBetween(ranked.pace, practice.pace),
  };
}

const gapBetween = (mine: number | null, theirs: number | null): number | null =>
  mine === null || theirs === null ? null : round2(mine - theirs);

/** Every scope sat IN THIS MODE: one sat only in practice must not be offered to a ranked chart. */
export const scopesSat = (
  subjects: readonly SubjectStanding[],
  mode: EvaluationMode,
): TestScope[] =>
  TEST_SCOPES.filter((scope) =>
    subjects.some((subject) =>
      subject.tallies.some(
        (tally) => tally.scope === scope && tally.evaluationMode === mode && tally.attempted > 0,
      ),
    ),
  );

const round2 = (value: number) => Math.round(value * 100) / 100;

export const OVERVIEW_ROUTES = {
  me: '/me/overview',
  ofStudent: (studentId: string) => `/admin/students/${studentId}/overview`,
} as const;

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

/** A share as a reader says it: the server keeps 2dp for averaging, a screen shows neither. */
export const percentLabel = (value: number | null, empty = '\u2014'): string =>
  value === null ? empty : `${Math.round(value)}%`;

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
// The banding convention, because a rollup's histogram and the one the report
// counts off `Attempt` when no rollup exists must be the same curve:
//
//   Ascending by `from`, contiguous, equal integer widths. `from` is inclusive
//   and `to` exclusive, except on the last band, which owns its top edge.
//   Bands span floor(lowest score) .. ceil(highest score) — negative marking
//   puts the floor below zero — in ~10 columns, each ceil(span / 10) wide and
//   never narrower than 1. A score off either end takes the nearest end band.
// ============================================================================

/** The shape `TestStat.scoreHistogram` holds. Read defensively — the column is free-form JSON. */
export const scoreHistogramSchema = z.array(cohortBandSchema);

export const cohortCurveBandSchema = cohortBandSchema.extend({
  /** True on exactly one band: the one holding this score, or the end band nearest it. */
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
  /** The rollup's histogram where one is written, else counted off the sittings; empty means none. */
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
  /** What the paper's topper spent here. Time is not answer-key, so it needs no gate. */
  topperTimeSec: z.number().int().nullable(),
  // Rank WITHIN a subject is deliberately absent: per-subject cohort ranking is its own pass.
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

// ============================================================================
// Series progression, drawn only for a series an admin has marked `progressive`.
// A ramp is read two ways: percentile against how hard each paper was graded, and
// each subject's accuracy over the same ordered papers. Both are ordered by
// `Test.seriesOrder` — the ramp is the sequence, not the calendar.
// ============================================================================

/** A paper's difficulty on one 0..100 scale, averaged over the grades its questions carry. */
export const DIFFICULTY_INDEX = {
  [DIFFICULTY_LEVEL.LOW]: 0,
  [DIFFICULTY_LEVEL.MEDIUM]: 50,
  [DIFFICULTY_LEVEL.HIGH]: 100,
} as const satisfies Record<DifficultyLevel, number>;

/** Accuracy points between the first and last measured sitting before a subject counts as moving. */
export const MASTERY_TREND_MIN_DELTA = 3;

export const MASTERY_TRENDS = {
  RISING: 'RISING',
  STEADY: 'STEADY',
  SLIDING: 'SLIDING',
} as const;
export const masteryTrendSchema = z.enum(MASTERY_TRENDS);
export type MasteryTrend = z.infer<typeof masteryTrendSchema>;

/** One rung: the paper, how hard it was graded, and where the student placed on it. */
export const rampStepSchema = z.object({
  testId: z.string(),
  title: z.string().nullable(),
  /** The latest sitting of this paper — the rung carries one point, not a retake history. */
  attemptId: z.string(),
  percentile: z.number().nullable(),
  /** Null where the paper served no graded question, which is not an easy paper. */
  difficulty: z.number().nullable(),
  questionCount: z.number().int(),
});
export type RampStep = z.infer<typeof rampStepSchema>;

/** One subject's accuracy on each rung, in step order and the same length as `steps`. */
export const masteryPointSchema = z.object({
  testId: z.string(),
  accuracy: z.number().nullable(),
  attempted: z.number().int(),
});
export type MasteryPoint = z.infer<typeof masteryPointSchema>;

export const subjectMasterySchema = z.object({
  subjectId: z.string(),
  subjectName: z.string(),
  points: z.array(masteryPointSchema),
  /** The first and last MEASURED rung, so an unattempted subject is never read as a fall to zero. */
  first: z.number().nullable(),
  last: z.number().nullable(),
  trend: masteryTrendSchema,
});
export type SubjectMastery = z.infer<typeof subjectMasterySchema>;

export const seriesProgressionSchema = z.object({
  seriesId: z.string(),
  steps: z.array(rampStepSchema),
  subjects: z.array(subjectMasterySchema),
});
export type SeriesProgression = z.infer<typeof seriesProgressionSchema>;

/** A series the student has sat at least one test in — what the scope picker offers. */
export const satSeriesSchema = z.object({
  id: z.string(),
  name: z.string(),
  progressive: z.boolean(),
  /** A composite FK ties every test to its series' mode, so this speaks for all of them. */
  evaluationMode: evaluationModeSchema,
});
export type SatSeries = z.infer<typeof satSeriesSchema>;
export const satSeriesListSchema = z.array(satSeriesSchema);

/** Never carries a question, an option or an answer key — at any scope, on either path. */
export const performanceReportSchema = z.object({
  /** This paper's clock against the cohort's average: above 1 is slower, below 1 faster. */
  paceIndex: z.number().nullable(),
  studentId: z.string(),
  scope: performanceScopeSchema,
  /** The id the scope was asked about. Null for ALL_TIME. */
  scopeId: z.string().nullable(),
  label: z.string().nullable(),
  /** The ANCHOR test's mode, which is what decides whether a cohort standing means anything. */
  evaluationMode: evaluationModeSchema.nullable(),
  /** Evaluated sittings in scope — what the trajectory plots, and only that. */
  attemptsCounted: z.number().int(),
  generatedAt: z.string(),
  trajectory: z.array(percentilePointSchema),
  /** Null wherever the scope spans more than one paper — marks do not compare across papers. */
  cohort: cohortCurveSchema.nullable(),
  /** The ANCHOR sitting, like everything below it: marks summed across papers are not a paper. */
  composition: markCompositionSchema,
  sections: z.array(sectionalStandingSchema),
  difficulty: z.array(difficultyStandingSchema),
  time: timeUseSchema,
  /** Only a SERIES scope on a `progressive` series has one; every other report reads null. */
  progression: seriesProgressionSchema.nullable(),
});
export type PerformanceReport = z.infer<typeof performanceReportSchema>;

// ============================================================================
// Reading a trend the way the Performance screen has to: which papers were sat,
// which sittings belong to one of them, and which of those went best. Marks are
// only ever compared WITHIN a test here — across papers they mean nothing.
// ============================================================================

/** One paper a student has sat, and the sitting that dates it. */
export interface SatTest {
  testId: string;
  title: string | null;
  evaluationMode: EvaluationMode;
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
      evaluationMode: point.evaluationMode,
      lastAttemptId: point.attemptId,
      lastSatAt: point.submittedAt,
    });
  }
  return [...seen.values()];
}

/** Every sitting of ONE paper, in the order they were sat — the retake line. */
export const sittingsOf = (points: readonly PerformancePoint[], testId: string) =>
  points.filter((point) => point.testId === testId);

/** The three counts every anchor-scoped figure divides by. */
export interface PaperCounts {
  correct: number;
  wrong: number;
  unattempted: number;
}

/** The anchor's own denominator, summed off its sections so every figure shares one paper. */
export function paperCounts(sections: readonly SectionalStanding[]): PaperCounts {
  return sections.reduce<PaperCounts>(
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

// ============================================================================
// The Question Report — one row per served question, the student's own beside
// the cohort's. Two halves with different rules: the cohort's item-stats are
// safe the moment they exist, while anything naming the RIGHT answer waits for
// `solutionsAreOpen`, exactly as the Solution Report does.
// ============================================================================

/** How hard the cohort ACTUALLY found a question, as opposed to how hard it was authored. */
export const SYSTEM_DIFFICULTY = { EASY: 'EASY', MEDIUM: 'MEDIUM', HARD: 'HARD' } as const;
export const systemDifficultySchema = z.enum(SYSTEM_DIFFICULTY);
export type SystemDifficulty = z.infer<typeof systemDifficultySchema>;

/** Tuned once, here. A p-value is the fraction who got it right, so higher is easier. */
export const SYSTEM_DIFFICULTY_EASY_FROM = 0.7;
export const SYSTEM_DIFFICULTY_MEDIUM_FROM = 0.4;

/** No p-value is not a band: nobody has attempted it, so the cohort has not said anything. */
export function systemDifficultyOf(pValue: number | null): SystemDifficulty | null {
  if (pValue === null) return null;
  if (pValue >= SYSTEM_DIFFICULTY_EASY_FROM) return SYSTEM_DIFFICULTY.EASY;
  return pValue >= SYSTEM_DIFFICULTY_MEDIUM_FROM
    ? SYSTEM_DIFFICULTY.MEDIUM
    : SYSTEM_DIFFICULTY.HARD;
}

/** GATED: past a p-value of one half, the option with the most votes IS the key, no inference. */
export const optionShareSchema = z.object({
  optionId: z.string(),
  /** Its place on the paper, so a screen can say "C" without loading the question. */
  position: z.number().int(),
  count: z.number().int(),
  isCorrect: z.boolean(),
});
export type OptionShare = z.infer<typeof optionShareSchema>;

/** One served question: what this student did with it, and what the cohort did with it. */
export const questionReportRowSchema = z.object({
  questionId: z.string(),
  paperQuestionId: z.string().nullable(),
  order: z.number().int(),
  baseConfigSectionId: z.string(),
  state: answerStateSchema,
  selectedOptionId: z.string().nullable(),
  typedAnswer: z.string().nullable(),
  isCorrect: z.boolean().nullable(),
  marksAwarded: z.number().nullable(),
  marks: z.number(),
  negativeMarks: z.number(),
  disposition: paperQuestionStatusSchema,
  timeSpentSec: z.number().int(),
  /** As authored. The cohort's own verdict on the same question is `systemDifficulty`. */
  predefinedDifficulty: difficultyLevelSchema.nullable(),
  // -------------------------------------------------------------------------
  // The cohort's, straight off the rollup. Every one of these is null until a
  // `TestQuestionStat` row exists — a dash on the screen, never a live count.
  // -------------------------------------------------------------------------
  /** Of the sittings served this question, the fraction that answered it. */
  attemptRate: z.number().nullable(),
  /** Of those who answered it, the fraction that got it right. */
  accuracy: z.number().nullable(),
  cohortAverageTimeSec: z.number().nullable(),
  systemDifficulty: systemDifficultySchema.nullable(),
  topperTimeSec: z.number().int().nullable(),
  topperMarksAwarded: z.number().nullable(),
  // -------------------------------------------------------------------------
  // Gated. Empty and null until `solutionsAreOpen`, and absent from the read
  // that builds the rest — the key is a second query, never a join.
  // -------------------------------------------------------------------------
  optionCounts: z.array(optionShareSchema),
  correctOptionId: z.string().nullable(),
  /** What a typed answer was compared against. Null for anything with options. */
  correctAnswer: z.string().nullable(),
});
export type QuestionReportRow = z.infer<typeof questionReportRowSchema>;

/** Above this share of the field answering it, a question the reader left blank was answerable. */
export const MOST_OF_THE_FIELD = 0.5;

/** What one paper says about how it was WORKED, as opposed to how much of it was known. */
export interface QuestionReportInsights {
  /** Left blank while most of the field answered — the questions nerve or the clock cost. */
  blankButAnswerable: number;
  timeOnCorrectSec: number;
  timeOnWrongSec: number;
  timeOnBlankSec: number;
  /** Of the whole clock, the share that bought no marks at all. */
  wastedShare: number | null;
}

export function questionReportInsights(rows: readonly QuestionReportRow[]): QuestionReportInsights {
  let blankButAnswerable = 0;
  let timeOnCorrectSec = 0;
  let timeOnWrongSec = 0;
  let timeOnBlankSec = 0;

  for (const row of rows) {
    if (row.isCorrect === true) timeOnCorrectSec += row.timeSpentSec;
    else if (row.isCorrect === false) timeOnWrongSec += row.timeSpentSec;
    else {
      timeOnBlankSec += row.timeSpentSec;
      if (row.attemptRate !== null && row.attemptRate >= MOST_OF_THE_FIELD) blankButAnswerable += 1;
    }
  }

  const total = timeOnCorrectSec + timeOnWrongSec + timeOnBlankSec;
  return {
    blankButAnswerable,
    timeOnCorrectSec,
    timeOnWrongSec,
    timeOnBlankSec,
    wastedShare: total === 0 ? null : round2(((timeOnWrongSec + timeOnBlankSec) / total) * 100),
  };
}

type CountedOption = QuestionReportRow['optionCounts'][number];

/** The option most of the field chose. Null where nothing was counted at all. */
export function distractorThatWon(row: QuestionReportRow): CountedOption | null {
  const top = row.optionCounts.reduce<CountedOption | null>(
    (best, option) => (best === null || option.count > best.count ? option : best),
    null,
  );
  return top === null || top.count === 0 ? null : top;
}

export const questionReportSchema = z.object({
  attemptId: z.string(),
  testId: z.string(),
  testTitle: z.string().nullable(),
  /** True once the key may be shown. The gated fields above are populated only then. */
  solutionsOpen: z.boolean(),
  /** What to say while it is shut, in the Solution Report's own words. Null once open. */
  closedReason: z.string().nullable(),
  /** Sittings behind the cohort columns. Zero means no rollup has run, not an empty cohort. */
  cohortSize: z.number().int(),
  /** This paper's time against the cohort's average: above 1 is slower, below 1 is faster. */
  paceIndex: z.number().nullable(),
  sections: z.array(examSectionSchema),
  questions: z.array(questionReportRowSchema),
});
export type QuestionReport = z.infer<typeof questionReportSchema>;

/** What the client filters the table by. The rows are all there; this only hides some. */
export const QUESTION_FILTERS = {
  ALL: 'all',
  CORRECT: 'correct',
  INCORRECT: 'incorrect',
  UNATTEMPTED: 'unattempted',
} as const;
export const questionFilterSchema = z.enum(QUESTION_FILTERS);
export type QuestionFilter = z.infer<typeof questionFilterSchema>;

export const PERFORMANCE_ROUTES = {
  me: '/me/performance/report',
  /** The series the picker may offer: one they have sat a test in, so a report cannot be empty. */
  mySeries: '/me/performance/series',
  ofStudent: (studentId: string) => `/admin/students/${studentId}/performance`,
  questionReportOfStudent: (studentId: string, attemptId: string) =>
    `/admin/students/${studentId}/attempts/${attemptId}/question-report`,
} as const;
