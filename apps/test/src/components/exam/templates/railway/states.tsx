/** The five answer states, drawn in CSS. Shared by the grid, the legend and the (i) tallies. */
import { useEffect, useRef } from 'react';
import { ANSWER_STATE, type AnswerState } from '@iace/contracts';
import { cn } from '@iace/ui';

export const STATE_CLASS: Readonly<Record<AnswerState, string>> = {
  [ANSWER_STATE.NOT_VISITED]: 'notvisited',
  [ANSWER_STATE.NOT_ANSWERED]: 'notanswered',
  [ANSWER_STATE.ANSWERED]: 'answered',
  [ANSWER_STATE.MARKED_REVIEW]: 'markforreview',
  [ANSWER_STATE.ANSWERED_MARKED]: 'answeredmarked',
};

/** The original's wording, kept verbatim — this skin reproduces a screen, it does not reword one. */
export const STATE_LABEL: Readonly<Record<AnswerState, string>> = {
  [ANSWER_STATE.ANSWERED]: 'Answered',
  [ANSWER_STATE.NOT_ANSWERED]: 'Not Answered',
  [ANSWER_STATE.NOT_VISITED]: 'Not Visited',
  [ANSWER_STATE.MARKED_REVIEW]: 'Marked for Review',
  [ANSWER_STATE.ANSWERED_MARKED]:
    'Answered and Marked for Review (will be considered for evaluation)',
};

/** The sidebar reads two across in this order; the (i) tally uses its own. */
export const LEGEND_ORDER: readonly AnswerState[] = [
  ANSWER_STATE.ANSWERED,
  ANSWER_STATE.NOT_ANSWERED,
  ANSWER_STATE.NOT_VISITED,
  ANSWER_STATE.MARKED_REVIEW,
  ANSWER_STATE.ANSWERED_MARKED,
];

export const TALLY_ORDER: readonly AnswerState[] = [
  ANSWER_STATE.ANSWERED,
  ANSWER_STATE.NOT_ANSWERED,
  ANSWER_STATE.MARKED_REVIEW,
  ANSWER_STATE.ANSWERED_MARKED,
  ANSWER_STATE.NOT_VISITED,
];

export function StateSwatch({ state, count }: Readonly<{ state: AnswerState; count: number }>) {
  return <span className={cn('rw-cell rw-swatch', STATE_CLASS[state])}>{count}</span>;
}

/** The original scrolls these panes by their scrollbar alone, so the wheel is refused. */
export function useScrollbarOnly<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const refuse = (event: WheelEvent) => event.preventDefault();
    node.addEventListener('wheel', refuse, { passive: false });
    return () => node.removeEventListener('wheel', refuse);
  }, []);

  return ref;
}
