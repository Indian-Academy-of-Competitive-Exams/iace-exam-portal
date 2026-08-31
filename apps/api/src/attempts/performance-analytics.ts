/**
 * The report's derivations, worked out without a database. Everything here obeys one rule the
 * screens depend on: a rate is never returned without the n it was measured over, so a bucket
 * nobody touched reads as null and never as a zero the student can mistake for a score.
 */
import {
  DIFFICULTY_LEVELS,
  PAPER_QUESTION_STATUS,
  scoreHistogramSchema,
  type AnalyticsBucket,
  type CohortBand,
  type CohortCurveBand,
  type DifficultyStanding,
  type MarkComposition,
  type MeasuredBucket,
  type PaperQuestionStatus,
  type ScoreCardSection,
  type SectionalStanding,
} from '@iace/contracts';
import { bucketOf, type AnalysedQuestion } from './attempt-analytics';

/** A served question with the paper's own terms for it, which is where the leaked marks live. */
export interface ReportedQuestion extends AnalysedQuestion {
  paperQuestionId: string | null;
  marks: number;
  negativeMarks: number;
  disposition: PaperQuestionStatus;
}

/** What the cohort rollup knows about one section of one paper. */
export interface SectionCohort {
  attempted: number;
  sumScore: number;
  sumTimeSec: number;
}

const HUNDREDTHS = 100;
const round = (value: number) => Math.round(value * HUNDREDTHS) / HUNDREDTHS;

/** The one difference from `bucketOf`: an untouched bucket has no accuracy rather than none of it. */
export function measure(bucket: AnalyticsBucket): MeasuredBucket {
  return { ...bucket, accuracy: bucket.attempted === 0 ? null : bucket.accuracy };
}

/** The three buckets partition `maxMarks`: each question has exactly one verdict. */
export function compositionOf(rows: readonly ReportedQuestion[]): MarkComposition {
  let maxMarks = 0;
  let earned = 0;
  let lostToWrong = 0;
  let lostToUnanswered = 0;
  let penalty = 0;

  for (const row of rows) {
    const paid = Math.max(row.marksAwarded, 0);
    maxMarks += row.marks;
    earned += paid;
    if (row.isCorrect === false) lostToWrong += row.marks - paid;
    else if (row.isCorrect === null) lostToUnanswered += row.marks - paid;
    // A dropped or bonus question pays out instead of charging, so only an ACTIVE one can bite.
    if (row.isCorrect === false && row.disposition === PAPER_QUESTION_STATUS.ACTIVE) {
      penalty += row.negativeMarks;
    }
  }

  return {
    maxMarks: round(maxMarks),
    earned: round(earned),
    lostToWrong: round(lostToWrong),
    lostToUnanswered: round(lostToUnanswered),
    penalty: round(penalty),
    net: round(earned - penalty),
  };
}

/** Their accuracy in each band against the p-value the cohort earned the label with. */
export function difficultyStandingOf(
  rows: readonly ReportedQuestion[],
  pValues: ReadonlyMap<string, number>,
): DifficultyStanding[] {
  return DIFFICULTY_LEVELS.map((level) => {
    const held = rows.filter((row) => row.difficulty === level);
    const measured = measuredPValues(held, pValues);
    return {
      ...measure(bucketOf(level, level, held)),
      cohortPValue:
        measured.length === 0
          ? null
          : round(measured.reduce((sum, value) => sum + value, 0) / measured.length),
      cohortQuestionCount: measured.length,
    };
  });
}

/** One p-value per PAPER question: three sittings of one paper is still one question measured. */
function measuredPValues(
  rows: readonly ReportedQuestion[],
  pValues: ReadonlyMap<string, number>,
): number[] {
  const seen = new Set<string>();
  const found: number[] = [];
  for (const row of rows) {
    if (row.paperQuestionId === null || seen.has(row.paperQuestionId)) continue;
    seen.add(row.paperQuestionId);
    const held = pValues.get(row.paperQuestionId);
    if (held !== undefined) found.push(held);
  }
  return found;
}

/** The cohort's curve with this student's column flagged. Empty in, empty out — never a flat line. */
export function curveBandsOf(histogram: unknown, score: number): CohortCurveBand[] {
  const parsed = scoreHistogramSchema.safeParse(histogram);
  return parsed.success ? flagYours(parsed.data, score) : [];
}

/** Exactly one column is theirs: a score off either end takes the end band nearest it. */
export function flagYours(bands: readonly CohortBand[], score: number): CohortCurveBand[] {
  if (bands.length === 0) return [];
  const yours = bandIndexOf(bands, score);
  return bands.map((band, index) => ({ ...band, isYours: index === yours }));
}

function bandIndexOf(bands: readonly CohortBand[], score: number): number {
  const last = bands.length - 1;
  const held = bands.findIndex(
    (band, index) => score >= band.from && (score < band.to || index === last),
  );
  if (held !== -1) return held;
  return score < (bands.at(0)?.from ?? score) ? 0 : last;
}

/** One distinct score and the sittings that landed on it — a grouped row, without the Decimal. */
export interface ScoreCount {
  score: number;
  count: number;
}

/** The curve counted off the sittings themselves, in the shape a rollup would have written. */
export interface CohortShape {
  topperScore: number | null;
  averageScore: number | null;
  size: number;
  bands: CohortBand[];
}

/** Columns to aim for, so a 200-mark paper reads in tens rather than in hundreds of them. */
const COHORT_BAND_TARGET = 10;

/** The banding convention is pinned beside `scoreHistogramSchema`; a rollup writer must match it. */
export function cohortShapeOf(counted: readonly ScoreCount[]): CohortShape {
  let size = 0;
  let total = 0;
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;

  for (const row of counted) {
    size += row.count;
    total += row.score * row.count;
    lowest = Math.min(lowest, row.score);
    highest = Math.max(highest, row.score);
  }
  if (size === 0) return { topperScore: null, averageScore: null, size: 0, bands: [] };

  return {
    topperScore: highest,
    averageScore: round(total / size),
    size,
    bands: bandsOf(counted, Math.floor(lowest), Math.ceil(highest)),
  };
}

function bandsOf(counted: readonly ScoreCount[], lo: number, hi: number): CohortBand[] {
  const width = Math.max(1, Math.ceil((hi - lo) / COHORT_BAND_TARGET));
  const columns = Math.max(1, Math.ceil((hi - lo) / width));
  const counts = Array.from({ length: columns }, () => 0);

  for (const row of counted) {
    const index = Math.min(Math.floor((row.score - lo) / width), columns - 1);
    counts[index] = (counts[index] ?? 0) + row.count;
  }
  return counts.map((count, index) => ({
    from: lo + index * width,
    to: lo + (index + 1) * width,
    count,
  }));
}

/** The student's sections with the cohort's mean laid beside them, and the n each mean is over. */
export function sectionalStandingOf(
  sections: readonly ScoreCardSection[],
  cohort: ReadonlyMap<string, SectionCohort>,
): SectionalStanding[] {
  return sections.map((section) => {
    const held = cohort.get(section.baseConfigSectionId);
    const n = held?.attempted ?? 0;
    return {
      ...section,
      cohortAverageScore: n === 0 ? null : round((held?.sumScore ?? 0) / n),
      cohortAverageTimeSec: n === 0 ? null : round((held?.sumTimeSec ?? 0) / n),
      cohortSampleSize: n,
    };
  });
}
