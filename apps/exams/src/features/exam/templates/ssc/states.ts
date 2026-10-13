/** The SSC skin's answer states: a coloured chip each, the two it draws alike sharing one class. */
import { ANSWER_STATE, type AnswerState, type PaletteCounts } from '@iace/contracts';

/** This screen has no colour of its own for a question opened and left: it stays "not attempted". */
export const STATE_CLASS: Readonly<Record<AnswerState, string>> = {
  [ANSWER_STATE.NOT_VISITED]: 'fresh',
  [ANSWER_STATE.NOT_ANSWERED]: 'fresh',
  [ANSWER_STATE.ANSWERED]: 'answered',
  [ANSWER_STATE.MARKED_REVIEW]: 'marked',
  [ANSWER_STATE.ANSWERED_MARKED]: 'answeredmarked',
};

export const STATE_LABEL: Readonly<Record<AnswerState, string>> = {
  [ANSWER_STATE.ANSWERED]: 'Answered',
  [ANSWER_STATE.NOT_ANSWERED]: 'Not Answered',
  [ANSWER_STATE.NOT_VISITED]: 'Not Visited',
  [ANSWER_STATE.MARKED_REVIEW]: 'Marked for review',
  [ANSWER_STATE.ANSWERED_MARKED]: 'Answered & Marked for review',
};

/** The rows of the tally under the palette, in the order this screen lists them. */
export const ANALYTICS_ORDER: readonly AnswerState[] = [
  ANSWER_STATE.ANSWERED,
  ANSWER_STATE.NOT_ANSWERED,
  ANSWER_STATE.MARKED_REVIEW,
  ANSWER_STATE.ANSWERED_MARKED,
];

/** An answer marked for review is evaluated, so the running total counts it. */
export const answeredOf = (counts: PaletteCounts): number =>
  counts[ANSWER_STATE.ANSWERED] + counts[ANSWER_STATE.ANSWERED_MARKED];

/** The Exam Summary's row: both kinds of mark under one heading, every question counted once. */
export function summaryOf(counts: PaletteCounts): {
  answered: number;
  notAnswered: number;
  marked: number;
  notVisited: number;
} {
  return {
    answered: counts[ANSWER_STATE.ANSWERED],
    notAnswered: counts[ANSWER_STATE.NOT_ANSWERED],
    marked: counts[ANSWER_STATE.MARKED_REVIEW] + counts[ANSWER_STATE.ANSWERED_MARKED],
    notVisited: counts[ANSWER_STATE.NOT_VISITED],
  };
}
