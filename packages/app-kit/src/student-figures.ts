/**
 * The figures and lines both student clients show about a test brief and a
 * sitting. One copy: web and mobile drifted apart while each held its own.
 */
import {
  COHORT_COMPARISON_FLOOR,
  COHORT_COUNT_EVERY_MIN,
  contentLanguageOf,
  instituteDayLabel,
  instituteWallTime,
  LANGUAGE_LABELS,
  LANGUAGE_MODE,
  QUESTION_FILTERS,
  round2,
  TIMER_TEMPLATE,
  type ExamBrief,
  type LanguageCode,
  type PerformancePoint,
  type QuestionReportRow,
  type TimerTemplate,
} from '@iace/contracts';

const DASH = '—';

export const totalMarksOf = (brief: ExamBrief): number =>
  round2(
    brief.sections.reduce(
      (sum, section) => sum + section.questionCount * section.marksPerQuestion,
      0,
    ),
  );

export const sectionMarksOf = (section: ExamBrief['sections'][number]): number =>
  round2(section.questionCount * section.marksPerQuestion);

/** One figure where every section agrees, and a range where they do not — never a wrong single one. */
export function negativeOf(brief: ExamBrief): string {
  const values = [...new Set(brief.sections.map((section) => section.negativeMarks))].sort(
    (a, b) => a - b,
  );
  if (values.length === 0) return DASH;
  if (values.length === 1) return `−${values[0]}`;
  return `−${values[0]} to −${values.at(-1)}`;
}

export const languagesOf = (brief: ExamBrief): string => {
  const named = brief.languages
    .map((code: LanguageCode) => LANGUAGE_LABELS[contentLanguageOf(code)])
    .join(', ');
  return brief.languageMode === LANGUAGE_MODE.DUAL ? `${named} (side by side)` : named;
};

/** Sections lock on their own clocks only under a sectional timer; an older server names none, so its durations answer. */
export const isSectionalPaper = (brief: {
  timerTemplate?: TimerTemplate;
  sections: readonly { durationSec: number | null }[];
}): boolean =>
  brief.timerTemplate === undefined
    ? brief.sections.some((section) => section.durationSec !== null)
    : brief.timerTemplate !== TIMER_TEMPLATE.COMPOSITE_FREE;

export const sectionalOf = (brief: ExamBrief): string => (isSectionalPaper(brief) ? 'Yes' : 'No');

const ORDINAL_SUFFIX = ['th', 'st', 'nd', 'rd'] as const;

/** st, nd, rd or th: the teens are the exception every naive rule gets wrong, and a fraction is always th. */
export function ordinalSuffix(value: number): string {
  const tens = value % 100;
  if (!Number.isInteger(value) || (tens >= 11 && tens <= 13)) return ORDINAL_SUFFIX[0];
  return ORDINAL_SUFFIX[value % 10] ?? ORDINAL_SUFFIX[0];
}

/** 1st, 22nd, 113th, 82.5th — a rank or a percentile as it is read. */
export const ordinal = (value: number): string => `${value}${ordinalSuffix(value)}`;

/** What a result reads as under a test's name: the marks, where it placed, and the day it was sat. */
export const resultLine = (point: PerformancePoint): string =>
  [
    `${point.score} of ${point.maxMarks} marks`,
    point.percentile === null ? null : `${ordinal(point.percentile)} percentile`,
    point.rank === null ? null : `rank ${point.rank}`,
    point.submittedAt === null ? null : `sat ${instituteDayLabel(point.submittedAt)}`,
  ]
    .filter((part) => part !== null)
    .join(' · ');

/** A pace index in a word: above one is slower than the field, below it faster, and exactly one is neither. */
export function paceWord(pace: number): string {
  if (pace === 1) return 'level';
  return pace > 1 ? 'slower' : 'faster';
}

/** The institute's clock, never the device's — a student abroad is still on an IST morning. */
const GREETINGS = [
  { until: 12, word: 'Good morning' },
  { until: 17, word: 'Good afternoon' },
  { until: 24, word: 'Good evening' },
] as const;

/** The name as the roster holds it, so the greeting reads the same on both clients. */
export function greetingFor(now: Date, name: string | null | undefined): string {
  const hour = Number(instituteWallTime(now).slice(11, 13));
  const word = (GREETINGS.find((band) => hour < band.until) ?? GREETINGS[2]).word;
  return name ? `${word}, ${name}` : word;
}

/** Names both facts a bar can carry, so the key and the reader's own pick never need two charts. */
export function optionMark(
  option: Readonly<{ isCorrect: boolean; optionId: string }>,
  chosen: string | null,
): string {
  const marks = [option.isCorrect ? 'correct' : null, option.optionId === chosen ? 'yours' : null];
  const named = marks.filter((mark) => mark !== null);
  return named.length === 0 ? '' : `: ${named.join(', ')}`;
}

export function matchesQuestionFilter(row: QuestionReportRow, filter: string): boolean {
  if (filter === QUESTION_FILTERS.CORRECT) return row.isCorrect === true;
  if (filter === QUESTION_FILTERS.INCORRECT) return row.isCorrect === false;
  if (filter === QUESTION_FILTERS.UNATTEMPTED) return row.isCorrect === null;
  return true;
}

export function yourAnswerOf(row: QuestionReportRow): string {
  if (row.typedAnswer !== null) return row.typedAnswer;
  const chosen = row.optionCounts.find((option) => option.optionId === row.selectedOptionId);
  return chosen === undefined ? DASH : `Option ${chosen.position}`;
}

export function correctAnswerOf(row: QuestionReportRow): string {
  if (row.correctAnswer !== null) return row.correctAnswer;
  const correct = row.optionCounts.find((option) => option.isCorrect);
  return correct === undefined ? DASH : `Option ${correct.position}`;
}

/** Why a cohort column is a dash: too few have sat it, or the pass that counts it has not run. */
export function cohortNoteSays(cohortSize: number): string {
  return cohortSize < COHORT_COMPARISON_FLOOR
    ? `Comparison against other students opens once ${COHORT_COMPARISON_FLOOR} have sat this paper.`
    : `The comparison against other students is counted every ${COHORT_COUNT_EVERY_MIN} minutes.`;
}
