import * as React from 'react';
import { cn } from '../../lib/utils';

/** Complete. Not a threshold anyone passes in — a bubble is full when it is full. */
const FULL = 1;

/** Empty to full while held. Long enough that a click cannot do it, short enough not to be a chore. */
export const FILL_BUBBLE_HOLD_MS = 900;

const FILL_LABELS = ['not filled', 'partly filled', 'filled'] as const;

const describe = (fill: number): string => {
  if (fill >= FULL) return FILL_LABELS[2];
  return fill > 0 ? FILL_LABELS[1] : FILL_LABELS[0];
};

export interface FillBubbleProps {
  /** Where it starts, 0 to 1. Holding accrues FROM this, so a partial bubble tops up. */
  fill: number;
  /** Once per gesture: on release, or the instant it reaches full. Never per frame. */
  onFillChange: (fill: number) => void;
  /** Names the control — the option's letter, or whatever the caller letters with. */
  label: string;
  disabled?: boolean;
  holdMs?: number;
  className?: string;
}

/** A bubble that fills while held. It reports a number and never learns what filling one means. */
export const FillBubble = React.forwardRef<HTMLButtonElement, FillBubbleProps>(
  (
    { fill, onFillChange, label, disabled = false, holdMs = FILL_BUBBLE_HOLD_MS, className },
    ref,
  ) => {
    const [held, setHeld] = React.useState<number | null>(null);
    const frame = React.useRef<number | null>(null);

    const shown = held ?? fill;

    const stop = React.useCallback(() => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    }, []);

    // Committed the moment it fills rather than on release: the student sees the ink take.
    const start = () => {
      if (disabled || fill >= FULL || held !== null) return;
      const from = fill;
      const began = performance.now();

      const tick = (now: number) => {
        const next = Math.min(FULL, from + (now - began) / holdMs);
        setHeld(next);
        if (next >= FULL) {
          stop();
          setHeld(null);
          onFillChange(FULL);
          return;
        }
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
      setHeld(from);
    };

    const release = () => {
      if (held === null) return;
      stop();
      const reached = held;
      setHeld(null);
      onFillChange(reached);
    };

    React.useEffect(() => stop, [stop]);

    return (
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={shown >= FULL}
        aria-label={`${label}, ${describe(shown)}`}
        disabled={disabled}
        className={cn(
          'relative grid size-7 shrink-0 place-items-center rounded-full border-2 transition-colors',
          'border-exam-option-border focus-visible:shadow-focus disabled:cursor-not-allowed',
          shown > 0 && 'border-exam-option-selected-border',
          className,
        )}
        onPointerDown={start}
        onPointerUp={release}
        onPointerLeave={release}
        onKeyDown={(event) => {
          // Space would scroll the page and Enter would fire a click; holding is the whole gesture.
          if (event.key !== ' ' || event.repeat) return;
          event.preventDefault();
          start();
        }}
        onKeyUp={(event) => event.key === ' ' && release()}
      >
        <span
          aria-hidden
          className="size-full rounded-full bg-exam-option-selected-border transition-transform"
          style={{ transform: `scale(${shown})` }}
        />
      </button>
    );
  },
);
FillBubble.displayName = 'FillBubble';
