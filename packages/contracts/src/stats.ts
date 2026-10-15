import { z } from 'zod';
import { TEST_SCOPES, testScopeSchema, type TestScope } from './tests';
import { todayISO } from './students';

// ============================================================================
// Analytics rollups. Pre-aggregated so the student dashboard and the admin test
// report are O(1) reads that never scan attempts. They store sums and counts;
// averages, accuracy and difficulty are derived when read.
//
// Rank and percentile are not among them: a sitting's standing moves as others
// sit the test, so it is counted live from the cohort instead.
// ============================================================================

// ============================================================================
// The overall dashboard — the READ side of the two tables above, and the only
// one. It is sums and counts all the way down, so every average is derived here
// on the way out and nothing new is stored.
//
// The two tables answer different questions and must not be crossed:
// `StudentStat`'s totals count EVERY sitting, retakes included, and only its
// graded fields (score, testsEvaluated) speak for the ranked slot.
// Accuracy and pace per scope come from `StudentSubjectStat`, which keys on the
// scope. The disposition donut has no per-scope source at all —
// `StudentSubjectStat` never counted an unattempted question — so it stays
// lifetime and says so on screen.
// ============================================================================

/** Below this many questions a subject is a rumour, not a reading — every screen greys it. */
export const SUBJECT_SAMPLE_FLOOR = 20;

/** Tallies off `StudentStat`, percentiles live. Every average is null at a zero denominator. */
/** Sittings a standing figure is counted over. One LATERAL cohort count each, so it is bounded. */
export const RECENT_STANDINGS = 5;

const overviewStandingSchema = z.object({
  /** Every folded sitting, retakes included — zero means nothing has been sat at all. */
  testsAttempted: z.number().int(),
  testsEvaluated: z.number().int(),
  retakeCount: z.number().int(),
  /** Over the RECENT_STANDINGS newest graded sittings, at the percentile each cohort gives it now. */
  avgPercentile: z.number().nullable(),
  bestPercentile: z.number().nullable(),
  avgScore: z.number().nullable(),
  /** Every sitting's clock, retakes included — the denominator of per-sitting effort. */
  sumTimeSec: z.number().int(),
  lastAttemptAt: z.string().nullable(),
});
export type OverviewStanding = z.infer<typeof overviewStandingSchema>;

/** LIFETIME, across every sitting: `StudentStat` is the only place these three live. */
const dispositionSchema = z.object({
  correct: z.number().int(),
  wrong: z.number().int(),
  unattempted: z.number().int(),
});
export type Disposition = z.infer<typeof dispositionSchema>;

/** One `StudentSubjectStat` row as the dashboard reads it — counts only, no derived figure. */
const subjectTallySchema = z.object({
  scope: testScopeSchema,
  attempted: z.number().int(),
  correct: z.number().int(),
  sumTimeSec: z.number().int(),
});
type SubjectTally = z.infer<typeof subjectTallySchema>;

/** A set of tallies summed to one reading. */
const subjectMeasureSchema = z.object({
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
const subjectStandingSchema = z.object({
  subjectId: z.string(),
  name: z.string(),
  /** One per scope the student has sat, so a scope filter needs no second call. */
  tallies: z.array(subjectTallySchema),
});
export type SubjectStanding = z.infer<typeof subjectStandingSchema>;

export const studentOverviewSchema = z.object({
  studentId: z.string(),
  generatedAt: z.string(),
  standing: overviewStandingSchema,
  /** Not scope-bound: there is no per-scope unattempted anywhere to bind it to. */
  disposition: dispositionSchema,
  /** What the accuracy and pace tiles read, summed off every subject row. */
  measure: subjectMeasureSchema,
  subjects: z.array(subjectStandingSchema),
});
export type StudentOverview = z.infer<typeof studentOverviewSchema>;

/** The ONE way tallies become a reading; a null scope sums every one, which is the default. */
export function measureOf(
  tallies: readonly SubjectTally[],
  scope: TestScope | null = null,
): SubjectMeasure {
  const counted = tallies.filter((tally) => scope === null || tally.scope === scope);
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
interface StandingTile {
  key: string;
  label: string;
  value: number | null;
  /** The split behind the headline, where one number hides two. */
  foot?: string;
}

/** Score and marking come from the sittings that held the ranked slot; every sitting is counted. */
const NOT_MARKED = 'Nothing marked yet';

export function standingTiles(standing: OverviewStanding): StandingTile[] {
  return [
    {
      key: 'score',
      label: 'Average score',
      value: standing.avgScore,
      foot: standing.avgScore === null ? NOT_MARKED : undefined,
    },
    { key: 'marked', label: 'Tests marked', value: standing.testsEvaluated },
    // Sittings, not tests: `testsAttempted` counts every one, so six retakes of a paper are six.
    {
      key: 'sittings',
      label: 'Sittings',
      value: standing.testsAttempted,
      foot: retakesFoot(standing.retakeCount),
    },
  ];
}

const retakesFoot = (count: number): string | undefined => {
  if (count <= 0) return undefined;
  return count === 1 ? '1 retake' : `${count} retakes`;
};

// ============================================================================
// Test days. A civil date, never an instant: a sitting submitted at 04:00
// IST belongs to that day, and `getUTC*` on the stored instant would put it on
// the one before. Every date here is a `YYYY-MM-DD` on the institute's clock.
// ============================================================================

/** One day on the calendar, and how many sittings landed on it. */
const testDaySchema = z.object({
  date: z.string(),
  sittings: z.number().int(),
});
export type TestDay = z.infer<typeof testDaySchema>;

/** The window the SERVER chose, with the days inside it — the account decides how far back. */
export const testCalendarSchema = z.object({
  from: z.string(),
  days: z.array(testDaySchema),
});
export type TestCalendar = z.infer<typeof testCalendarSchema>;

const DAY_MS = 86_400_000;

/** A civil date shifted by whole days. Safe on the string: a calendar date carries no zone. */
function shiftCivilDate(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00.000Z`);
  return new Date(at.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Every day from `from` to `today` inclusive, oldest first, zeros filled in. */
export function testDayWindow(
  sat: readonly TestDay[],
  from: string,
  today: string = todayISO(),
): TestDay[] {
  const counted = new Map(sat.map((day) => [day.date, day.sittings]));
  const days: TestDay[] = [];
  for (let date = from; date <= today; date = shiftCivilDate(date, 1)) {
    days.push({ date, sittings: counted.get(date) ?? 0 });
  }
  return days;
}

/** Consecutive days ending today, or yesterday: a day still in progress cannot break a run. */
export function currentStreak(sat: readonly TestDay[], today: string = todayISO()): number {
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
export function longestStreak(sat: readonly TestDay[]): number {
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

const daysWithSittings = (sat: readonly TestDay[]) =>
  new Set(sat.filter((day) => day.sittings > 0).map((day) => day.date));

/** The three shares the disposition can answer. LIFETIME: `StudentStat` holds no scope to split by. */
interface DispositionRates {
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

/** Where the hours went against what they bought back, each as a share of the whole. */
interface SubjectShare {
  subjectId: string;
  name: string;
  attempted: number;
  correct: number;
  sumTimeSec: number;
  /** Of everything answered, the share this subject took. */
  attemptedShare: number;
  timeShare: number;
  correctShare: number;
  /** Correct share minus time share: above zero the subject is paying for the clock it takes. */
  payoff: number;
}

export function subjectShares(
  subjects: readonly SubjectStanding[],
  scope: TestScope | null = null,
): SubjectShare[] {
  const measured = subjects
    .map((subject) => ({ subject, measure: measureOf(subject.tallies, scope) }))
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

/** One subject read at one scope, which is the unit every ranking below sorts. */
interface RankedSubject {
  subjectId: string;
  name: string;
  measure: SubjectMeasure;
}

/** Weakest first, and what is still too thin to rank — a subject is never branded off five questions. */
interface SubjectRanking {
  /** Ascending by accuracy, each one past the floor. */
  weakest: RankedSubject[];
  /** Answered, but under the floor: shown as "not enough data yet" rather than ranked. */
  thin: RankedSubject[];
}

/** The weakest-first read of the rollup. Nothing here proposes a paper — a student cannot sit one they made. */
export function rankSubjectsByWeakness(
  subjects: readonly SubjectStanding[],
  scope: TestScope | null = null,
  floor: number = SUBJECT_SAMPLE_FLOOR,
): SubjectRanking {
  const measured = subjects
    .map((subject) => ({
      subjectId: subject.subjectId,
      name: subject.name,
      measure: measureOf(subject.tallies, scope),
    }))
    .filter((row) => row.measure.attempted > 0);

  const byAccuracy = (a: RankedSubject, b: RankedSubject) =>
    (a.measure.accuracy ?? 0) - (b.measure.accuracy ?? 0);

  return {
    weakest: measured.filter((row) => row.measure.attempted >= floor).sort(byAccuracy),
    thin: measured
      .filter((row) => row.measure.attempted < floor)
      .sort((a, b) => b.measure.attempted - a.measure.attempted),
  };
}

/** Two scopes set against each other, per subject: whether a full paper holds what a short one showed. */
interface ScopeComparison {
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

/** The two scopes with the most behind them — a comparison needs volume on both sides. */
export function scopeComparison(subjects: readonly SubjectStanding[]): ScopeComparison | null {
  const busiest = volumeByScope(subjects)
    .filter((row) => row.attempted > 0)
    .sort((a, b) => b.attempted - a.attempted);
  const first = busiest[0]?.scope;
  const second = busiest[1]?.scope;
  if (first === undefined || second === undefined) return null;
  const compared = subjects
    .map((subject) => {
      const one = measureOf(subject.tallies, first);
      const two = measureOf(subject.tallies, second);
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

/** How much of each kind of paper has been sat. A scope missing here is a blind spot. */
export function volumeByScope(
  subjects: readonly SubjectStanding[],
): { scope: TestScope; attempted: number }[] {
  return TEST_SCOPES.map((scope) => ({
    scope,
    attempted: subjects.reduce(
      (sum, subject) => sum + measureOf(subject.tallies, scope).attempted,
      0,
    ),
  }));
}

const gapBetween = (mine: number | null, theirs: number | null): number | null =>
  mine === null || theirs === null ? null : round2(mine - theirs);

export const scopesSat = (subjects: readonly SubjectStanding[]): TestScope[] =>
  TEST_SCOPES.filter((scope) =>
    subjects.some((subject) =>
      subject.tallies.some((tally) => tally.scope === scope && tally.attempted > 0),
    ),
  );

export const round2 = (value: number) => Math.round(value * 100) / 100;

export const OVERVIEW_ROUTES = {
  me: '/me/overview',
} as const;
