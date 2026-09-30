/**
 * The figures and lines both student clients show about a test brief and a
 * sitting. One copy: web and mobile drifted apart while each held its own.
 */
import {
  contentLanguageOf,
  instituteDayLabel,
  instituteWallTime,
  LANGUAGE_LABELS,
  LANGUAGE_MODE,
  round2,
  type ExamBrief,
  type LanguageCode,
  type PerformancePoint,
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

export const sectionalOf = (brief: ExamBrief): string =>
  brief.sections.some((section) => section.durationSec !== null) ? 'Yes' : 'No';

/** What a result reads as under a test's name: the marks, where it placed, and the day it was sat. */
export const resultLine = (point: PerformancePoint): string =>
  [
    `${point.score} of ${point.maxMarks} marks`,
    point.percentile === null ? null : `${point.percentile}th percentile`,
    point.rank === null ? null : `rank ${point.rank}`,
    point.submittedAt === null ? null : `sat ${instituteDayLabel(point.submittedAt)}`,
  ]
    .filter((part) => part !== null)
    .join(' · ');

/** The institute's clock, never the device's — a student abroad is still on an IST morning. */
const GREETINGS = [
  { until: 12, word: 'Good morning' },
  { until: 17, word: 'Good afternoon' },
  { until: 24, word: 'Good evening' },
] as const;

/** The first name only: a greeting is not a formal address. */
export function greetingFor(now: Date, name: string | null | undefined): string {
  const hour = Number(instituteWallTime(now).slice(11, 13));
  const word = (GREETINGS.find((band) => hour < band.until) ?? GREETINGS[2]).word;
  return name ? `${word}, ${name.trim().split(/\s+/)[0]}` : word;
}
