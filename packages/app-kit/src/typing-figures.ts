/** What a typing standard asks for and what a session came to, in the words the boards use. */
import { TYPING_METRIC, type TypingMetric, type TypingPreset } from '@iace/contracts';

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

export const targetLabel = (preset: TypingPreset) =>
  `${preset.target.toLocaleString('en-IN')} ${METRIC_UNITS[preset.metric]}`;

/** A whole mistake and a half one, as the single figure the rule counts. */
export const mistakesOf = (row: { fullMistakes: number; halfMistakes: number }) =>
  row.fullMistakes + row.halfMistakes / 2;
