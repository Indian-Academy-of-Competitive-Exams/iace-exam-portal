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

/**
 * The one spinner. Every wait in the product turns at the same speed.
 *
 * FOR ACTIONS, NOT FOR CONTENT. A spinner belongs where somebody just did
 * something and is waiting for it to take — a button mid-request, a toggle
 * mid-save, a file being read. Content arriving into a page uses `Skeleton`,
 * which holds the layout it is about to fill; a spinner there collapses the
 * region to a dot and then throws the page around when the data lands.
 *
 * The exception is a wait with no shape to hold: the app deciding whether
 * anyone is signed in, before there is a page at all.
 */
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
 * A spinner with a line of text: "Reading the file…", "Sending the code…".
 *
 * Same rule as `Spinner` — this is for an ACTION with something to say about
 * itself, not for content on its way onto a page. If the answer to "what is
 * loading" is a table, a list, a card or a form, the answer is `Skeleton`,
 * because all four have a shape that can be held while they arrive.
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
