import { type AnswerState, type LiveAnswer } from '@iace/contracts';
import { type HeldState } from './attempt-state';

/** What the flusher writes, worked out without a database so it can be read as a table. */

export interface FlushRow {
  questionId: string;
  data: {
    selectedOptionId: string | null;
    typedAnswer: string | null;
    state: AnswerState;
    timeSpentSec: number;
    answeredAt: Date | null;
  };
}

/** Every value comes off the held state and none off the clock, so running it twice is a no-op. */
export function rowsToFlush(held: HeldState): FlushRow[] {
  return Object.entries(held.answers).map(([questionId, answer]) => ({
    questionId,
    data: {
      selectedOptionId: answer.selectedOptionId,
      typedAnswer: answer.typedAnswer,
      state: answer.state,
      timeSpentSec: answer.timeSpentSec,
      answeredAt: answer.answeredAt === null ? null : new Date(answer.answeredAt),
    },
  }));
}

/** The flush read backwards: what a lost live key is put back from, so a resume keeps its answers. */
export function answersFromRows(
  rows: readonly {
    questionId: string;
    state: AnswerState;
    selectedOptionId: string | null;
    typedAnswer: string | null;
    timeSpentSec: number;
    answeredAt: Date | null;
  }[],
): Record<string, LiveAnswer> {
  const answers: Record<string, LiveAnswer> = {};
  for (const row of rows) {
    answers[row.questionId] = {
      state: row.state,
      selectedOptionId: row.selectedOptionId,
      typedAnswer: row.typedAnswer,
      timeSpentSec: row.timeSpentSec,
      answeredAt: row.answeredAt?.toISOString() ?? null,
    };
  }
  return answers;
}
