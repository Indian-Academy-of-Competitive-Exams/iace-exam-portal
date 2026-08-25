import * as React from 'react';
import { cn } from '../../lib/utils';

/** Splitting a whole number three ways. The parts ARE the counts, so the total cannot drift. */

export interface RatioPart {
  key: string;
  label: string;
  /** The fill, and the swatch beside its count. */
  className: string;
}

export type RatioValues = [number, number, number];

export interface RatioBarProps {
  parts: readonly [RatioPart, RatioPart, RatioPart];
  values: Readonly<RatioValues>;
  /** What the three add up to, and always will. */
  total: number;
  onChange: (values: RatioValues) => void;
  disabled?: boolean;
  className?: string;
}

/** A handle takes from one side and gives to the other, so the part beyond it never moves. */
function moved(values: Readonly<RatioValues>, handle: 0 | 1, to: number): RatioValues {
  const [low, medium, high] = values;
  if (handle === 0) {
    const sum = low + medium;
    const left = Math.max(0, Math.min(sum, to));
    return [left, sum - left, high];
  }
  const sum = medium + high;
  const left = Math.max(0, Math.min(sum, to));
  return [low, left, sum - left];
}

const STEP_KEYS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowDown: -1,
  ArrowRight: 1,
  ArrowUp: 1,
};

export function RatioBar({
  parts,
  values,
  total,
  onChange,
  disabled,
  className,
}: Readonly<RatioBarProps>) {
  const share = (value: number) => (total === 0 ? 0 : (value / total) * 100);

  const fills = [
    { part: parts[0], value: values[0] },
    { part: parts[1], value: values[1] },
    { part: parts[2], value: values[2] },
  ];

  const grips = ([0, 1] as const).map((handle) => {
    const before = parts[handle];
    const after = handle === 0 ? parts[1] : parts[2];
    const own = values[handle];
    const beyond = handle === 0 ? values[1] : values[2];
    return {
      handle,
      key: before.key,
      at: handle === 0 ? values[0] : values[0] + values[1],
      label: `${before.label} and ${after.label}`,
      text: `${own} ${before.label}, ${beyond} ${after.label}`,
      now: own,
    };
  });

  const press = (handle: 0 | 1) => (event: React.KeyboardEvent<HTMLDivElement>) => {
    const boundary = handle === 0 ? values[0] : values[0] + values[1];
    const step = STEP_KEYS[event.key];
    const target = step === undefined ? endFor(event.key, handle, values) : boundary + step;
    if (target === null) return;

    event.preventDefault();
    onChange(moved(values, handle, handle === 0 ? target : target - values[0]));
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="relative flex h-8 w-full overflow-hidden rounded-md border border-border">
        {fills.map((fill) => (
          <div
            key={fill.part.key}
            style={{ width: `${share(fill.value)}%` }}
            className={cn('h-full transition-[width]', fill.part.className)}
          />
        ))}

        {grips.map((grip) => (
          <div
            key={grip.key}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={grip.label}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={grip.now}
            aria-valuetext={grip.text}
            aria-disabled={disabled || undefined}
            onKeyDown={disabled ? undefined : press(grip.handle)}
            style={{ left: `${share(grip.at)}%` }}
            className={cn(
              'absolute top-0 h-full w-1 -translate-x-1/2 cursor-col-resize bg-foreground/40',
              'focus-visible:shadow-focus focus-visible:outline-none',
              disabled && 'cursor-not-allowed',
            )}
          />
        ))}
      </div>

      <ol className="flex flex-wrap gap-x-6 gap-y-1">
        {fills.map((fill) => (
          <li key={fill.part.key} className="flex items-center gap-2 text-sm">
            <span className={cn('size-3 shrink-0 rounded-sm', fill.part.className)} aria-hidden />
            <span className="text-muted-foreground">{fill.part.label}</span>
            <span className="font-medium tabular-nums text-foreground">{fill.value}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Home and End take a handle to its own end, which is how a slider is expected to behave. */
function endFor(key: string, handle: 0 | 1, values: Readonly<RatioValues>): number | null {
  if (key === 'Home') return handle === 0 ? 0 : values[0];
  if (key === 'End')
    return handle === 0 ? values[0] + values[1] : values[0] + values[1] + values[2];
  return null;
}
