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
  /**
   * What is being waited for, in words.
   *
   * Given: the spinner becomes a live region and announces itself, for a reader
   * who sees no animation. Omitted: it is hidden from assistive tech entirely,
   * which is the right answer when the text beside it already says what is
   * happening — otherwise the wait is announced twice.
   */
  label?: string;
  className?: string;
}

/** The one spinner. Every wait in the product turns at the same speed. */
export function Spinner({ size = 'md', label, className }: Readonly<SpinnerProps>) {
  const glyph = (
    <Loader2
      className={cn(SIZES[size], 'shrink-0 animate-spin text-muted-foreground', className)}
      aria-hidden
    />
  );

  // <output> rather than a div with role="status": the element carries the
  // live region natively, and the glyph inside it stays hidden so the label is
  // announced once rather than alongside "graphic".
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

/**
 * A line that says something is on its way.
 *
 * Half the screens said it with a spinner and half with the bare word
 * "Loading…", which is the same event told two different ways depending on
 * which file you were in. This is the smaller of the two waits: a skeleton is
 * for content whose shape we already know, and a bare line for everything else.
 *
 * The text carries the announcement, so the spinner beside it is decoration —
 * marking both would announce the wait twice.
 */
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
