/**
 * One served question, the student's own beside the cohort's, worked out without a database. The
 * gated half is passed in already fetched or not at all: nothing here can reach a key it was not
 * handed, which is what keeps the ungated read honest.
 */
import {
  systemDifficultyOf,
  type OptionShare,
  type QuestionReportRow,
  type QuestionOption,
} from '@iace/contracts';
import { type TopperQuestion } from './topper';

/** A `TestQuestionStat` row as the report reads it — counts only, never an option's verdict. */
export interface CohortItem {
  attemptedCount: number;
  skippedCount: number;
  correctCount: number;
  sumTimeSec: number;
  pValue: number | null;
  optionCounts: Record<string, number>;
}

/** The student's own row, from the select that never loads a `questionVersion`. */
export interface SatQuestion {
  questionId: string;
  paperQuestionId: string | null;
  order: number;
  baseConfigSectionId: string;
  state: QuestionReportRow['state'];
  selectedOptionId: string | null;
  typedAnswer: string | null;
  isCorrect: boolean | null;
  marksAwarded: number | null;
  marks: number;
  negativeMarks: number;
  disposition: QuestionReportRow['disposition'];
  timeSpentSec: number;
  predefinedDifficulty: QuestionReportRow['predefinedDifficulty'];
}

/** What the key adds, fetched only past the gate. Absent means the gate is still shut. */
export interface KeyedQuestion {
  options: readonly QuestionOption[];
  correctAnswer: string | null;
}

export function questionReportRow(
  sat: SatQuestion,
  cohort: CohortItem | null,
  topper: TopperQuestion | null,
  keyed: KeyedQuestion | null,
): QuestionReportRow {
  const served = cohort === null ? 0 : cohort.attemptedCount + cohort.skippedCount;
  return {
    ...sat,
    attemptRate: served === 0 ? null : ratio(cohort?.attemptedCount ?? 0, served),
    accuracy: cohort?.pValue ?? null,
    // Everyone SERVED it spent time on it, so the clock is divided by them and not by the answerers.
    cohortAverageTimeSec: served === 0 ? null : ratio(cohort?.sumTimeSec ?? 0, served),
    systemDifficulty: systemDifficultyOf(cohort?.pValue ?? null),
    topperTimeSec: topper?.timeSpentSec ?? null,
    topperMarksAwarded: topper?.marksAwarded ?? null,
    optionCounts: keyed === null ? [] : sharesOf(keyed.options, cohort?.optionCounts ?? {}),
    correctOptionId: keyed === null ? null : (correctOf(keyed.options)?.id ?? null),
    correctAnswer: keyed?.correctAnswer ?? null,
  };
}

/** Whole paper against whole paper: a per-question ratio would compare two different denominators. */
export function paceIndexOf(
  yourTimeSec: number,
  cohortSumTimeSec: number,
  cohortSize: number,
): number | null {
  if (cohortSize === 0) return null;
  const average = cohortSumTimeSec / cohortSize;
  // A cohort with no clock is not a cohort that was quick: there is no comparison to draw.
  if (!Number.isFinite(average) || average === 0) return null;
  return round(yourTimeSec / average, PACE_PLACES);
}

/** Every option with its share, in the order the paper puts them. */
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

function correctOf(options: readonly QuestionOption[]): QuestionOption | null {
  return options.find((option) => option.isCorrect === true) ?? null;
}

const RATIO_PLACES = 4;
const PACE_PLACES = 2;

const ratio = (part: number, whole: number) => round(part / whole, RATIO_PLACES);

function round(value: number, places: number): number {
  const steps = 10 ** places;
  return Math.round(value * steps) / steps;
}
