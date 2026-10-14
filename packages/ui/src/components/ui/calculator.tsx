/**
 * The on-screen calculator a government CBT offers. Non-modal and draggable on
 * purpose: a candidate works a sum against the question, so a panel that blocked
 * the paper would be the wrong instrument. Exam tokens throughout, so each skin
 * re-colours it with no edit here.
 */
import * as React from 'react';
import { X } from 'lucide-react';
import { Button } from './button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';
import { cn } from '../../lib/utils';

const KEY =
  'h-10 rounded border border-exam-border bg-exam-surface text-sm text-exam-ink transition hover:bg-exam-surface-2 focus-visible:shadow-focus focus-visible:outline-none';

const SPANS = { TALL: 'row-span-2 h-auto', WIDE: 'col-span-2' } as const;

export interface CalculatorProps {
  display: string;
  /** Four columns of keys; the behaviour behind them lives with the caller, shared with the phone. */
  keypad: readonly Readonly<{ key: string; operator: boolean; span?: keyof typeof SPANS }>[];
  onKey: (key: string) => void;
  onClose: () => void;
  className?: string;
}

export function Calculator({
  display,
  keypad,
  onKey,
  onClose,
  className,
}: Readonly<CalculatorProps>) {
  const [at, setAt] = React.useState<{ x: number; y: number } | null>(null);
  const panel = React.useRef<HTMLFieldSetElement>(null);
  const grip = React.useRef<{ dx: number; dy: number } | null>(null);

  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    const box = panel.current?.getBoundingClientRect();
    if (!box) return;
    grip.current = { dx: event.clientX - box.left, dy: event.clientY - box.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  // Clamped to the frame it sits in: a panel dragged off the edge of a running paper is gone.
  const onDrag = (event: React.PointerEvent<HTMLElement>) => {
    const held = grip.current;
    const box = panel.current?.getBoundingClientRect();
    const frame = panel.current?.offsetParent?.getBoundingClientRect();
    if (!held || !box || !frame) return;
    setAt({
      x: within(event.clientX - held.dx - frame.left, frame.width - box.width),
      y: within(event.clientY - held.dy - frame.top, frame.height - box.height),
    });
  };

  // The frame can shrink under a panel that was dragged to its edge, so the clamp follows the frame too.
  React.useEffect(() => {
    const frame = panel.current?.offsetParent;
    if (!frame) return;
    const observer = new ResizeObserver(() => {
      const box = panel.current?.getBoundingClientRect();
      const bounds = frame.getBoundingClientRect();
      if (!box) return;
      setAt((held) => {
        if (!held) return held;
        const x = within(held.x, bounds.width - box.width);
        const y = within(held.y, bounds.height - box.height);
        return x === held.x && y === held.y ? held : { x, y };
      });
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <fieldset
      ref={panel}
      aria-label="Calculator"
      style={at ? { left: at.x, top: at.y } : undefined}
      className={cn(
        'absolute z-[--z-overlay] w-60 min-w-0 overflow-hidden rounded-md border border-exam-border bg-exam-surface shadow-overlay',
        at ? null : 'bottom-24 right-6',
        className,
      )}
    >
      <div
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={() => (grip.current = null)}
        className="flex cursor-grab touch-none items-center justify-between gap-2 border-b border-exam-border bg-exam-surface-2 py-1 pl-3 pr-1 active:cursor-grabbing"
      >
        <span className="text-xs font-semibold text-exam-ink">Calculator</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="iconSm"
              // Exam ink, not the design system's: a skin with no dark variant must not get a dark glyph.
              className="text-exam-ink hover:bg-exam-surface-2"
              onClick={onClose}
            >
              <X aria-hidden />
              <span className="sr-only">Close the calculator</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close the calculator</TooltipContent>
        </Tooltip>
      </div>

      <output
        aria-live="polite"
        className="block truncate border-b border-exam-border px-3 py-2 text-right font-mono text-xl text-exam-ink"
      >
        {display}
      </output>

      <div className="grid grid-cols-4 gap-1 p-1">
        {keypad.map(({ key, operator, span }) => (
          <button
            key={key}
            type="button"
            onClick={() => onKey(key)}
            className={cn(
              KEY,
              operator ? 'font-semibold text-exam-current' : 'font-medium',
              span === 'TALL' && 'bg-exam-surface-2',
              span && SPANS[span],
            )}
          >
            {key}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const within = (value: number, max: number): number =>
  Math.min(Math.max(0, value), Math.max(0, max));
