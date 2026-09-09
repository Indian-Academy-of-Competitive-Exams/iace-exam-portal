import {
  ATTEMPT_STATUS,
  TEST_BUCKET,
  testAction,
  testBucket,
  type StudentCatalogSeries,
  type StudentCatalogTest,
  type TestBucket,
} from '@iace/contracts';

/** How far through a series a student is. Pure, so both the shelf and the series page share it. */
export interface SeriesProgress {
  total: number;
  done: number;
  percent: number;
}

export function seriesProgress(series: StudentCatalogSeries): SeriesProgress {
  const total = series.tests.length;
  const done = series.tests.filter(
    (test) => test.attemptStatus !== null && test.attemptStatus !== ATTEMPT_STATUS.IN_PROGRESS,
  ).length;
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

/** Bare number over the sittings that HAVE one — a practice retake is unranked, not a zero. */
export const averagePercentile = (points: readonly { percentile: number | null }[]) => {
  const ranked = points.map((point) => point.percentile).filter((value) => value !== null);
  if (ranked.length === 0) return '—';
  return `${Math.round(ranked.reduce((sum, value) => sum + value, 0) / ranked.length)}`;
};

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
