/** The report's words and small derivations, one copy for the web and the phone. */
import {
  round2,
  type Disposition,
  type PerformancePoint,
  type SectionalStanding,
  type TimeUse,
} from '@iace/contracts';

export const WRITTEN_NOTICE =
  'Written answers here are marked by automatic checks, not by an examiner. The real exam evaluates your writing, so this result may not be accurate.';

export const RETAKE_NOTICE = 'This was a retake, so it is marked but it does not carry a rank.';

export const NO_MARKS_YET = {
  title: 'No marks yet',
  hint: 'Your paper is handed in and safe.',
} as const;

export const NO_SECTION_QUESTIONS = 'Nothing was served in this section.';

export const REPORT_FAILED = {
  scoreCard: 'Your score card did not load',
  sections: 'Your sections did not load',
  questions: 'Your question report did not load',
  solutions: 'Your paper did not load',
} as const;

const DASH = '—';

/** A paper with no marks is never ranked, so being unranked there says nothing about a retake. */
export const isRetake = (point: PerformancePoint): boolean => !point.isGraded && point.maxMarks > 0;

/** A typing-only paper carries no marks, and "0 of 0" would read as a failure. */
export const marksOf = (point: PerformancePoint): string | undefined =>
  point.maxMarks === 0 ? undefined : `${point.score} of ${point.maxMarks} marks`;

/** What a minute in a section bought: the one figure that crosses marks with time. */
export function perMinute(score: number | null, seconds: number | null): string {
  if (score === null || seconds === null || seconds === 0) return DASH;
  return round2(score / (seconds / 60)).toFixed(2);
}

/** A bare seconds figure that turns to minutes at 60, as the question report's summary reads it. */
export const clock = (seconds: number): string =>
  seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;

/** Seconds as the time card words them: whole seconds under a minute, else rounded minutes. */
export const timeWords = (seconds: number): string =>
  seconds < 60 ? `${Math.round(seconds)}s` : `${Math.round(seconds / 60)} min`;

export interface Benchmark {
  average: number | null;
  topper: number | null;
}

/** The topper's clock is only known per SECTION, so their paper is the sum of those. */
export function timeBenchmark(sections: readonly SectionalStanding[]): Benchmark | undefined {
  const measured = sections.filter((section) => section.topperTimeSec !== null);
  if (measured.length === 0) return undefined;
  const averages = sections.map((section) => section.cohortAverageTimeSec);

  return {
    average: averages.includes(null)
      ? null
      : averages.reduce((sum: number, v) => sum + (v ?? 0), 0),
    topper: measured.reduce((total, section) => total + (section.topperTimeSec ?? 0), 0),
  };
}

export type TimeTone = 'positive' | 'negative' | 'neutral';

export interface TimeSegment {
  key: string;
  label: string;
  seconds: number;
  tone: TimeTone;
}

/** How the clock was spent; what the three measured parts leave over is Unscored. */
export function timeSegments(time: TimeUse, counts: Disposition): TimeSegment[] {
  const onCorrect = Math.round(time.avgOnCorrectSec * counts.correct);
  const onWrong = Math.round(time.avgOnWrongSec * counts.wrong);
  const rest = Math.max(0, time.totalSec - onCorrect - onWrong - time.spentOnUnattemptedSec);
  const segments: TimeSegment[] = [
    { key: 'correct', label: 'On right answers', seconds: onCorrect, tone: 'positive' },
    { key: 'wrong', label: 'On wrong answers', seconds: onWrong, tone: 'negative' },
    {
      key: 'left',
      label: 'On questions left',
      seconds: time.spentOnUnattemptedSec,
      tone: 'neutral',
    },
  ];
  return rest > 0
    ? [...segments, { key: 'rest', label: 'Unscored', seconds: rest, tone: 'neutral' }]
    : segments;
}

/** A signed difference, so "ahead" and "behind" read without a colour. */
export const signed = (value: number): string =>
  value > 0 ? `+${round2(value)}` : String(round2(value));
