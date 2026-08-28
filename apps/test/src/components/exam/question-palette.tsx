import { ANSWER_STATES, type AnswerState, type LiveAnswer } from '@iace/contracts';
import { cn } from '@iace/ui';
import { PALETTE_LEGEND } from '../../lib/constants';

/** The grid every candidate reads before they read anything else. */

const SWATCH: Readonly<Record<AnswerState, string>> = {
  NOT_VISITED: 'bg-exam-notvisited text-exam-notvisited-ink',
  NOT_ANSWERED: 'bg-exam-notanswered text-exam-notanswered-ink',
  ANSWERED: 'bg-exam-answered text-exam-answered-ink',
  MARKED_REVIEW: 'bg-exam-marked text-exam-marked-ink',
  ANSWERED_MARKED: 'bg-exam-answered-marked text-exam-answered-marked-ink',
};

export function QuestionPalette({
  questionIds,
  answers,
  currentId,
  counts,
  onOpen,
}: Readonly<{
  questionIds: readonly string[];
  answers: Readonly<Record<string, LiveAnswer>>;
  currentId: string | null;
  counts: Readonly<Record<AnswerState, number>>;
  onOpen: (questionId: string) => void;
}>) {
  return (
    <div className="flex flex-col gap-exam-gap">
      <ul className="flex flex-col gap-1.5">
        {ANSWER_STATES.map((state) => (
          <li key={state} className="flex items-center gap-2 text-xs">
            <span className={cn('size-4 shrink-0 rounded-exam-cell', SWATCH[state])} />
            <span className="text-exam-ink-muted">
              {PALETTE_LEGEND.find((entry) => entry.state === state)?.label}
            </span>
            <span className="ml-auto font-semibold tabular-nums text-exam-ink">
              {counts[state]}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-exam-cell-gap">
        {questionIds.map((id, index) => {
          const state = answers[id]?.state ?? 'NOT_VISITED';
          return (
            <button
              key={id}
              type="button"
              aria-current={id === currentId ? 'true' : undefined}
              onClick={() => onOpen(id)}
              className={cn(
                'flex size-exam-cell items-center justify-center rounded-exam-cell text-xs font-semibold tabular-nums',
                'focus-visible:shadow-focus focus-visible:outline-none',
                SWATCH[state],
                // Positional only: an outline, never a fill, so it cannot read as a state.
                id === currentId && 'outline outline-2 outline-offset-1 outline-exam-current',
              )}
            >
              {index + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
