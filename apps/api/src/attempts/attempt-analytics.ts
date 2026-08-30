/**
 * What a finished sitting says about how it was sat, derived and never instrumented: every number
 * here comes off rows the exam already wrote — the option chosen, the palette state, the seconds
 * on each question — plus the question's own subject and difficulty.
 */
import {
  ANSWER_STATE,
  DIFFICULTY_LEVELS,
  type AnalyticsBucket,
  type AnswerState,
  type AttemptStrategy,
  type DifficultyLevel,
  type TimeUse,
} from '@iace/contracts';

/** One answered question, with the little the analytics needs to know about it. */
export interface AnalysedQuestion {
  baseConfigSectionId: string;
  subjectId: string;
  subjectName: string;
  difficulty: DifficultyLevel;
  state: AnswerState;
  /** What they DID, not what it was worth: a question with an unusable key was still answered. */
  answered: boolean;
  isCorrect: boolean | null;
  marksAwarded: number;
  timeSpentSec: number;
}

const HUNDREDTHS = 100;
const round = (value: number) => Math.round(value * HUNDREDTHS) / HUNDREDTHS;

/** Correct over ATTEMPTED, not over the paper: leaving a question out is not getting it wrong. */
export function bucketOf(
  key: string,
  name: string,
  rows: readonly AnalysedQuestion[],
): AnalyticsBucket {
  const correct = rows.filter((row) => row.isCorrect === true).length;
  const wrong = rows.filter((row) => row.isCorrect === false).length;
  const attempted = rows.filter((row) => row.answered).length;
  return {
    key,
    name,
    total: rows.length,
    attempted,
    correct,
    wrong,
    unattempted: rows.length - attempted,
    accuracy: attempted === 0 ? 0 : round((correct / attempted) * 100),
    marks: round(rows.reduce((sum, row) => sum + row.marksAwarded, 0)),
    timeSpentSec: rows.reduce((sum, row) => sum + row.timeSpentSec, 0),
  };
}

/** Buckets in the order the keys are given, so a section keeps the paper's order. */
export function bucketsBy(
  rows: readonly AnalysedQuestion[],
  keyOf: (row: AnalysedQuestion) => string,
  nameOf: (row: AnalysedQuestion) => string,
): AnalyticsBucket[] {
  const grouped = new Map<string, AnalysedQuestion[]>();
  for (const row of rows) {
    const key = keyOf(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped.entries()].map(([key, held]) => bucketOf(key, nameOf(held[0]!), held));
}

/** Every difficulty, including one the paper never asked — an empty band is a fact too. */
export function byDifficulty(rows: readonly AnalysedQuestion[]): AnalyticsBucket[] {
  return DIFFICULTY_LEVELS.map((level) =>
    bucketOf(
      level,
      level,
      rows.filter((row) => row.difficulty === level),
    ),
  );
}

export function timeUseOf(rows: readonly AnalysedQuestion[]): TimeUse {
  const spent = (held: readonly AnalysedQuestion[]) =>
    held.reduce((sum, row) => sum + row.timeSpentSec, 0);
  const mean = (held: readonly AnalysedQuestion[]) =>
    held.length === 0 ? 0 : round(spent(held) / held.length);

  const right = rows.filter((row) => row.isCorrect === true);
  const wrong = rows.filter((row) => row.isCorrect === false);
  return {
    totalSec: spent(rows),
    avgPerQuestionSec: mean(rows),
    avgOnCorrectSec: mean(right),
    avgOnWrongSec: mean(wrong),
    // Time on a question they walked away from is time the paper took and gave nothing back.
    spentOnUnattemptedSec: spent(rows.filter((row) => !row.answered)),
  };
}

/** The five palette states, which PARTITION the paper — a stacked bar of them cannot double-count. */
export function strategyOf(rows: readonly AnalysedQuestion[]): AttemptStrategy {
  const inState = (state: AnswerState) => rows.filter((row) => row.state === state).length;

  return {
    answered: inState(ANSWER_STATE.ANSWERED),
    answeredAndMarked: inState(ANSWER_STATE.ANSWERED_MARKED),
    markedOnly: inState(ANSWER_STATE.MARKED_REVIEW),
    seenAndLeft: inState(ANSWER_STATE.NOT_ANSWERED),
    neverOpened: inState(ANSWER_STATE.NOT_VISITED),
  };
}
