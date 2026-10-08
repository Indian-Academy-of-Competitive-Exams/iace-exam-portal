import { ANSWER_STATES, isStateShown, type AnswerState, type LiveAnswer } from '@iace/contracts';
import { cn } from '@iace/ui';
import { ANSWER_STATE_LABELS } from '@iace/app-kit';

/** The grid every candidate reads before they read anything else. */

const SWATCH: Readonly<Record<AnswerState, string>> = {
  NOT_VISITED: 'bg-exam-notvisited text-exam-notvisited-ink',
  NOT_ANSWERED: 'bg-exam-notanswered text-exam-notanswered-ink',
  ANSWERED: 'bg-exam-answered text-exam-answered-ink',
  MARKED_REVIEW: 'bg-exam-marked text-exam-marked-ink',
  // The same body as a bare flag: the tick is what says an answer is banked under it.
  ANSWERED_MARKED: cn(
    'bg-exam-answered-marked text-exam-answered-marked-ink',
    'after:absolute after:-bottom-px after:-right-px after:size-1/3 after:rounded-full',
    'after:bg-exam-answered-marked-tick after:ring-2 after:ring-exam-surface',
  ),
};

export function PaletteLegend({
  forwardOnly,
  counts,
}: Readonly<{ forwardOnly: boolean; counts?: Readonly<Record<AnswerState, number>> }>) {
  return (
    <ul className="flex flex-col gap-1.5">
      {ANSWER_STATES.filter((state) => isStateShown(state, forwardOnly)).map((state) => (
        <li key={state} className="flex items-center gap-2 text-xs">
          <span className={cn('relative size-4 shrink-0 rounded-exam-cell', SWATCH[state])} />
          <span className="text-exam-ink-muted">{ANSWER_STATE_LABELS[state]}</span>
          {counts ? (
            <span className="ml-auto font-semibold tabular-nums text-exam-ink">
              {counts[state]}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function QuestionPalette({
  questionIds,
  answers,
  currentId,
  counts,
  forwardOnly = false,
  canOpen,
  onOpen,
}: Readonly<{
  questionIds: readonly string[];
  answers: Readonly<Record<string, LiveAnswer>>;
  currentId: string | null;
  counts: Readonly<Record<AnswerState, number>>;
  /** A forward-only paper reaches three of the five states; the other two never earn a row. */
  forwardOnly?: boolean;
  canOpen?: (questionId: string) => boolean;
  onOpen: (questionId: string) => void;
}>) {
  return (
    <div className="flex flex-col gap-exam-gap">
      <PaletteLegend forwardOnly={forwardOnly} counts={counts} />

      <div className="flex flex-wrap gap-exam-cell-gap">
        {questionIds.map((id, index) => {
          const state = answers[id]?.state ?? 'NOT_VISITED';
          return (
            <button
              key={id}
              type="button"
              aria-current={id === currentId ? 'true' : undefined}
              aria-label={`Question ${index + 1}, ${ANSWER_STATE_LABELS[state]}`}
              disabled={canOpen ? !canOpen(id) : false}
              onClick={() => onOpen(id)}
              className={cn(
                'relative flex size-exam-cell items-center justify-center rounded-exam-cell text-xs font-semibold tabular-nums',
                'focus-visible:shadow-focus focus-visible:outline-none',
                'disabled:cursor-not-allowed disabled:opacity-50',
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
