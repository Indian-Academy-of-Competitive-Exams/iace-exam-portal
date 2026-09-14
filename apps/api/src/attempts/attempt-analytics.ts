/**
 * What a finished sitting says about how it was sat, derived and never instrumented: every number
 * here comes off rows the exam already wrote — the option chosen, the palette state, the seconds
 * on each question — plus the question's own subject and difficulty.
 */
import { type AnswerState, type DifficultyLevel, type TimeUse } from '@iace/contracts';
import { roundHundredths as round } from './attempt-report';

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
