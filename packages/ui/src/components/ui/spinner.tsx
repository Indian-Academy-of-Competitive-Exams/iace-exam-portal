import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

const SIZES = {
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-6',
} as const;

export type SpinnerSize = keyof typeof SIZES;

export interface SpinnerProps {
  size?: SpinnerSize;
  /** What is being waited for. Given, it announces itself; omitted, it is hidden. */
  label?: string;
  className?: string;
}

/** For ACTIONS, not content — content arriving into a page uses `Skeleton`. */
export function Spinner({ size = 'md', label, className }: Readonly<SpinnerProps>) {
  /* eslint-disable no-restricted-syntax -- this component IS the spinner the rule points callers at. */
  const glyph = (
    <Loader2
      className={cn(SIZES[size], 'shrink-0 animate-spin text-muted-foreground', className)}
      aria-hidden
    />
  );
  /* eslint-enable no-restricted-syntax */

  // <output> carries the live region natively; the glyph inside stays hidden.
  return label ? (
    <output aria-label={label} className="inline-flex">
      {glyph}
    </output>
  ) : (
    glyph
  );
}

export interface LoadingStateProps {
  /** What is being waited for. The default covers the ordinary case. */
  children?: React.ReactNode;
  size?: SpinnerSize;
  className?: string;
}

/** A spinner with a line of text. For an action; the text carries the announcement. */
export function LoadingState({
  children = 'Loading…',
  size = 'md',
  className,
}: Readonly<LoadingStateProps>) {
  return (
    <output className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
      <Spinner size={size} />
      {children}
    </output>
  );
}
