/** What a typing standard asks for and what a session came to, in the words the boards use. */
import {
  QUESTION_TYPE,
  TYPING_METRIC,
  TYPING_RULE,
  type ExamQuestion,
  type TypingMetric,
  type TypingPreset,
  type TypingRule,
} from '@iace/contracts';
import { plural } from '@iace/ui';

const SECONDS_PER_MINUTE = 60;

export const METRIC_UNITS: Readonly<Record<TypingMetric, string>> = {
  WPM: 'words a minute',
  KEY_DEPRESSIONS: 'key depressions',
  KEY_DEPRESSIONS_PER_HOUR: 'key depressions an hour',
};

/** The three figures a session is read by; which one leads depends on the standard's metric. */
export interface TypingFigures {
  netWpm: number;
  keyDepressions: number;
  keyDepressionsPerHour?: number;
}

/** The one number the standard is held to. An hourly rate a stored session lacks is scaled back up. */
export function headlineOf(preset: TypingPreset, figures: TypingFigures): number {
  if (preset.metric === TYPING_METRIC.WPM) return figures.netWpm;
  if (preset.metric === TYPING_METRIC.KEY_DEPRESSIONS) return figures.keyDepressions;
  const perHour = (figures.keyDepressions * SECONDS_PER_MINUTE ** 2) / preset.durationSec;
  return Math.round(figures.keyDepressionsPerHour ?? perHour);
}

export const durationLabel = (preset: TypingPreset) =>
  plural(preset.durationSec / SECONDS_PER_MINUTE, 'minute');

export const targetLabel = (preset: TypingPreset) =>
  `${preset.target.toLocaleString('en-IN')} ${METRIC_UNITS[preset.metric]}`;

export function mistakeRuleLabel(rule: TypingRule): string {
  if (rule.shape === TYPING_RULE.ERROR_CEILING) return `Within ${rule.ceilingPct}% of words typed`;
  return `${rule.allowancePct}% ignored, then ${plural(rule.penaltyWords, 'word')} off for each`;
}

/** A whole mistake and a half one, as the single figure the rule counts. */
export const mistakesOf = (row: { fullMistakes: number; halfMistakes: number }) =>
  row.fullMistakes + row.halfMistakes / 2;

/** Whether this question is typed rather than answered, which every skin asks before drawing options. */
export const isTypingQuestion = (question: ExamQuestion | undefined): boolean =>
  question?.type === QUESTION_TYPE.TYPING;
