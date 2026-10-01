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
import {
  CALCULATOR_KEYS,
  CALCULATOR_OPS,
  CALCULATOR_START,
  pressCalculatorKey,
  type CalculatorState,
} from './calculator-keys';

/** Four columns, so `=` takes the two rows beside the last digits and `0` takes two columns. */
const KEYPAD: readonly Readonly<{ key: string; span?: string }>[] = [
  { key: CALCULATOR_KEYS.CLEAR },
  { key: CALCULATOR_KEYS.BACKSPACE },
  { key: CALCULATOR_OPS.DIVIDE },
  { key: CALCULATOR_OPS.MULTIPLY },
  { key: '7' },
  { key: '8' },
  { key: '9' },
  { key: CALCULATOR_OPS.SUBTRACT },
  { key: '4' },
  { key: '5' },
  { key: '6' },
  { key: CALCULATOR_OPS.ADD },
  { key: '1' },
  { key: '2' },
  { key: '3' },
  { key: CALCULATOR_KEYS.EQUALS, span: 'row-span-2 h-auto' },
  { key: '0', span: 'col-span-2' },
  { key: CALCULATOR_KEYS.DECIMAL },
];

const KEY =
  'h-10 rounded border border-exam-border bg-exam-surface text-sm text-exam-ink transition hover:bg-exam-surface-2 focus-visible:shadow-focus focus-visible:outline-none';

/** An operator reads as the instruction, a digit as the number: all the colour has to say. */
const OPERATORS = new Set<string>([...Object.values(CALCULATOR_OPS), CALCULATOR_KEYS.EQUALS]);

export interface CalculatorProps {
  onClose: () => void;
  className?: string;
}

export function Calculator({ onClose, className }: Readonly<CalculatorProps>) {
  const [state, setState] = React.useState<CalculatorState>(CALCULATOR_START);
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
        {state.display}
      </output>

      <div className="grid grid-cols-4 gap-1 p-1">
        {KEYPAD.map(({ key, span }) => (
          <button
            key={key}
            type="button"
            onClick={() => setState((before) => pressCalculatorKey(before, key))}
            className={cn(
              KEY,
              OPERATORS.has(key) ? 'font-semibold text-exam-current' : 'font-medium',
              key === CALCULATOR_KEYS.EQUALS && 'bg-exam-surface-2',
              span,
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
