import {
  AppException,
  ATTEMPT_STATUS,
  ErrorCodes,
  TEST_BUCKET,
  TEST_SHUT,
  instituteDayLabel,
  isSat,
  testAction,
  testBucket,
  testIsOpen,
  type PerformancePoint,
  type PerformanceTrend,
  type StudentCatalogSeries,
  type StudentCatalogTest,
  type TestBucket,
  type TestShut,
} from '@iace/contracts';

/** NOT_FOUND or FORBIDDEN is the server refusing this student; offline or a 5xx can be retried. */
export const isBriefRefused = (error: unknown): boolean =>
  AppException.is(error) &&
  (error.code === ErrorCodes.NOT_FOUND || error.code === ErrorCodes.FORBIDDEN);

/** One paper each, in the order a student would reach for them — never the same one twice. */
export function waitingOn(rows: readonly Sittable[]): Sittable[] {
  const running = continueWith(rows);
  const open = openNow(rows).find((row) => row.test.id !== running?.test.id);
  return [running, open, upNext(rows)[0]].filter((row) => row !== undefined);
}

/** How far through a series a student is. Pure, so both the shelf and the series page share it. */
export interface SeriesProgress {
  total: number;
  done: number;
  percent: number;
}

export function seriesProgress(series: StudentCatalogSeries): SeriesProgress {
  const total = series.tests.length;
  const done = series.tests.filter((test) => isSat(test.attemptStatus)).length;
  return { total, done, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** One test, ready to draw: which shelf it sits on and what its button does. */
export interface Sittable {
  test: StudentCatalogTest;
  seriesId: string;
  seriesName: string;
  bucket: TestBucket;
  action: 'START' | 'RESUME' | null;
}

export function sittablesOf(series: readonly StudentCatalogSeries[]): Sittable[] {
  return series.flatMap((one) =>
    one.tests.map((test) => ({
      test,
      seriesId: one.id,
      seriesName: one.name,
      bucket: testBucket(test),
      action: testAction(test),
    })),
  );
}

/** The one thing to do next: a sitting already running beats anything a student has not opened. */
export function continueWith(rows: readonly Sittable[]): Sittable | undefined {
  return rows.find((row) => row.test.attemptStatus === ATTEMPT_STATUS.IN_PROGRESS);
}

/** Open now, in the order the institute set them: nothing shuts, so nothing is more urgent. */
export function openNow(rows: readonly Sittable[]): Sittable[] {
  return rows.filter((row) => row.bucket === TEST_BUCKET.OPEN);
}

/** What opens next, soonest first. */
export function upNext(rows: readonly Sittable[]): Sittable[] {
  return rows
    .filter((row) => row.bucket === TEST_BUCKET.LATER)
    .sort((a, b) => opensAt(a) - opensAt(b));
}

/** A search over what a student can see: the test's own name, and the series carrying it. */
export function matching(rows: readonly Sittable[], term: string): Sittable[] {
  const wanted = term.trim().toLowerCase();
  if (wanted === '') return [...rows];
  return rows.filter((row) =>
    `${row.test.title ?? ''} ${row.seriesName}`.toLowerCase().includes(wanted),
  );
}

const FAR_FUTURE = Number.MAX_SAFE_INTEGER;
const opensAt = (row: Sittable) =>
  row.test.opensAt === null ? FAR_FUTURE : Date.parse(row.test.opensAt);

/** The best (lowest) rank across a set of scored points, or '—' when none carry one. */
export const bestRank = (points: readonly { rank: number | null }[]) => {
  const ranked = points.map((point) => point.rank).filter((rank) => rank !== null);
  return ranked.length === 0 ? '—' : Math.min(...ranked);
};

/** Bare number, not "N%" — the caller supplies the unit, and guards it when this is '—'. */
export const averageAccuracy = (points: readonly { accuracy: number }[]) => {
  if (points.length === 0) return '—';
  const mean = points.reduce((sum, point) => sum + point.accuracy, 0) / points.length;
  return `${Math.round(mean)}`;
};

/** Every sitting, oldest first, with the standing the chart counted; one older than the chart reads unranked. */
export function everySitting(trend: PerformanceTrend | undefined): PerformancePoint[] {
  const plotted = new Map(trend?.points.map((point) => [point.attemptId, point]));
  return (trend?.sittings ?? trend?.points ?? []).map(
    (sitting) => plotted.get(sitting.attemptId) ?? { ...sitting, rank: null, percentile: null },
  );
}

/** What a sat paper scored, joined onto its catalog card from the trend a screen already holds. */
export interface TestResult {
  attemptId: string;
  score: number;
  maxMarks: number;
  percentile: number | null;
}

/** The newest sitting of each paper, so a retake's card shows the retake and not the first go. */
export function resultsByTest(
  points: readonly (TestResult & { testId: string })[],
): ReadonlyMap<string, TestResult> {
  const held = new Map<string, TestResult>();
  for (const point of points) {
    held.set(point.testId, {
      attemptId: point.attemptId,
      score: point.score,
      maxMarks: point.maxMarks,
      percentile: point.percentile,
    });
  }
  return held;
}

/** What shuts a test, as a button's few words and as the sentence a details page has room for. */
export const SHUT_SAYS: Readonly<Record<TestShut, { label: string; notice: string }>> = {
  [TEST_SHUT.HOLD]: {
    label: 'Test access on hold',
    notice: 'Your test access is on hold. Nothing here can be started until your branch lifts it.',
  },
  [TEST_SHUT.NOT_OPEN]: {
    label: 'Not open yet',
    notice: 'This paper has not opened yet. Nothing can be started until it does.',
  },
  [TEST_SHUT.TURN]: {
    label: 'Waiting its turn',
    notice: 'This paper is waiting its turn. Finish the test before it to reach this one.',
  },
};

/** A paper they have sat and may start again: that sitting is marked, never ranked. */
export const offersRetake = (test: StudentCatalogTest): boolean =>
  isSat(test.attemptStatus) && testAction(test) === 'START';

/** Told before a retake starts, in the report's own words for it. */
export const RETAKE_SAYS = 'This will be a retake, so it is marked but it does not carry a rank.';

/** Which fact shuts a test that cannot be started; `now` only guesses for a server older than `shut`. */
export function shutOf(test: StudentCatalogTest, now: Date): TestShut {
  if (test.shut) return test.shut;
  return testIsOpen(test.opensAt, now) ? TEST_SHUT.TURN : TEST_SHUT.NOT_OPEN;
}

/** Why there is no button. "Waiting its turn" is not an error and must not read like one. */
export const shutReason = (test: StudentCatalogTest, now: Date): string =>
  SHUT_SAYS[shutOf(test, now)].label;

/** Reaching nothing and searching for nothing are different facts, and they read differently. */
export const EMPTINESS = { NONE: 'NONE', FILTERED: 'FILTERED' } as const;
export type Emptiness = (typeof EMPTINESS)[keyof typeof EMPTINESS] | null;

/** Counted in TESTS: a series holding none is reached, and still leaves nothing a filter could have hidden. */
export function emptyReason(reaches: readonly StudentCatalogSeries[], showing: number): Emptiness {
  if (reaches.every((series) => series.tests.length === 0)) return EMPTINESS.NONE;
  return showing === 0 ? EMPTINESS.FILTERED : null;
}

/** Which sitting of the paper this was, and the day it was sat — in the institute's own zone. */
export function sittingHint(point: PerformancePoint): string {
  return [`Attempt ${point.attemptNo}`, instituteDayLabel(point.submittedAt)]
    .filter((part) => part !== null)
    .join(' · ');
}

/** Seconds read as minutes on a result screen; nobody counts a paper in seconds. */
export function minutes(seconds: number | null): string {
  if (seconds === null) return '—';
  const rounded = Math.round(seconds);
  const whole = Math.floor(rounded / 60);
  return whole === 0 ? `${rounded}s` : `${whole}m`;
}
