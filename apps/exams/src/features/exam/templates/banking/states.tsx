/** The five answer states of the banking skin, drawn in CSS and shared by the grid, the legend and the tab tallies. */
import { ANSWER_STATE, type AnswerState, type PaletteCounts } from '@iace/contracts';
import { cn } from '@iace/ui';

export const STATE_CLASS: Readonly<Record<AnswerState, string>> = {
  [ANSWER_STATE.NOT_VISITED]: 'notvisited',
  [ANSWER_STATE.NOT_ANSWERED]: 'notanswered',
  [ANSWER_STATE.ANSWERED]: 'answered',
  [ANSWER_STATE.MARKED_REVIEW]: 'marked',
  [ANSWER_STATE.ANSWERED_MARKED]: 'answeredmarked',
};

export const STATE_LABEL: Readonly<Record<AnswerState, string>> = {
  [ANSWER_STATE.ANSWERED]: 'Answered',
  [ANSWER_STATE.NOT_ANSWERED]: 'Not Answered',
  [ANSWER_STATE.NOT_VISITED]: 'Not Visited',
  [ANSWER_STATE.MARKED_REVIEW]: 'Marked For Review',
  [ANSWER_STATE.ANSWERED_MARKED]: 'Answered & Marked For Review',
};

/** Two across in the sidebar, with the long last one on a row of its own. */
export const LEGEND_ORDER: readonly AnswerState[] = [
  ANSWER_STATE.ANSWERED,
  ANSWER_STATE.NOT_ANSWERED,
  ANSWER_STATE.NOT_VISITED,
  ANSWER_STATE.MARKED_REVIEW,
  ANSWER_STATE.ANSWERED_MARKED,
];

export function StateBadge({ state, count }: Readonly<{ state: AnswerState; count?: number }>) {
  return <span className={cn('bk-cell bk-badge', STATE_CLASS[state])}>{count}</span>;
}

/** An answer marked for review is still evaluated, so the summary counts it as answered. */
export function summaryOf(counts: PaletteCounts): {
  answered: number;
  notAnswered: number;
  notVisited: number;
} {
  return {
    answered: counts[ANSWER_STATE.ANSWERED] + counts[ANSWER_STATE.ANSWERED_MARKED],
    notAnswered: counts[ANSWER_STATE.NOT_ANSWERED] + counts[ANSWER_STATE.MARKED_REVIEW],
    notVisited: counts[ANSWER_STATE.NOT_VISITED],
  };
}
