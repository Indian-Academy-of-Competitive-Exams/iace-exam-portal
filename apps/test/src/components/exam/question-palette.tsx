import { ANSWER_STATES, type AnswerState, type LiveAnswer } from '@iace/contracts';
import { cn } from '@iace/ui';
import { PALETTE_LEGEND } from '../../lib/constants';

/** The grid every candidate reads before they read anything else. */

const SWATCH: Readonly<Record<AnswerState, string>> = {
  NOT_VISITED: 'bg-muted text-muted-foreground',
  NOT_ANSWERED: 'bg-destructive text-destructive-foreground',
  ANSWERED: 'bg-success text-success-foreground',
  MARKED_REVIEW: 'bg-primary text-primary-foreground',
  ANSWERED_MARKED: 'bg-warning text-warning-foreground',
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
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-1.5">
        {ANSWER_STATES.map((state) => (
          <li key={state} className="flex items-center gap-2 text-xs">
            <span className={cn('size-4 shrink-0 rounded', SWATCH[state])} />
            <span className="text-muted-foreground">
              {PALETTE_LEGEND.find((entry) => entry.state === state)?.label}
            </span>
            <span className="ml-auto font-semibold tabular-nums text-foreground">
              {counts[state]}
            </span>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-5 gap-1.5">
        {questionIds.map((id, index) => {
          const state = answers[id]?.state ?? 'NOT_VISITED';
          return (
            <button
              key={id}
              type="button"
              aria-current={id === currentId ? 'true' : undefined}
              onClick={() => onOpen(id)}
              className={cn(
                'flex size-9 items-center justify-center rounded text-xs font-semibold tabular-nums',
                'focus-visible:shadow-focus focus-visible:outline-none',
                SWATCH[state],
                id === currentId && 'ring-2 ring-ring ring-offset-1 ring-offset-surface',
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
