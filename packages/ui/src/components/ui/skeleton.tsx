import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Placeholders in the shape of what is coming.
 *
 * Two rules from the style guide are built in rather than restated per screen:
 *
 *   · Only for a wait over ~300ms. Below that a skeleton flashes and reads as
 *     jank — show nothing at all instead.
 *   · Match the real content's shape. A skeleton the wrong size causes a
 *     layout jump when the data lands, which is worse than a spinner.
 *
 * Prefer this to `LoadingState` wherever the shape is already known — a table
 * of rows, a row of stat tiles — because it holds the layout still. Where it is
 * not known, a line of text is the honest answer.
 */
const VARIANTS = {
  /** A line of body copy. */
  text: 'h-[1em] rounded-sm',
  /** A heading — shorter than the measure, as headings are. */
  title: 'h-[1.5em] w-2/5 rounded-sm',
  /** An avatar, a status dot. Give it a size. */
  circle: 'rounded-full',
  /** One row of a table. */
  row: 'h-[--row-h-comfortable] rounded-sm',
  /** A stat tile on a dashboard. */
  kpi: 'h-[7.5rem] rounded-xl',
} as const;

export type SkeletonVariant = keyof typeof VARIANTS;

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: SkeletonVariant;
}

export function Skeleton({ className, variant = 'text', ...props }: Readonly<SkeletonProps>) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative overflow-hidden bg-[--skeleton-base]',
        VARIANTS[variant],
        // The sweep is a ::after so it can travel across a box of any size.
        'after:absolute after:inset-0 after:-translate-x-full',
        'after:bg-gradient-to-r after:from-transparent after:via-[--skeleton-shine] after:to-transparent',
        'after:animate-skeleton-sweep',
        // Keep the placeholder, drop the motion. The global reduced-motion rule
        // only shortens animations, which would leave the sheen parked at one
        // end — a bright band that looks like part of the design.
        'motion-reduce:after:hidden',
        className,
      )}
      {...props}
    />
  );
}

/** Stable keys for placeholder rows, which have no identity of their own. */
const LINE_KEYS = Array.from({ length: 12 }, (_, index) => `skeleton-line-${index}`);

export interface SkeletonParagraphProps extends React.HTMLAttributes<HTMLDivElement> {
  lines?: number;
}

/**
 * A block of text on its way.
 *
 * The last line is short, because the last line of a real paragraph always is —
 * a stack of full-width bars is the tell that gives away a fake skeleton.
 */
export function SkeletonParagraph({
  lines = 3,
  className,
  ...props
}: Readonly<SkeletonParagraphProps>) {
  return (
    <div className={cn('flex flex-col gap-2', className)} {...props}>
      {LINE_KEYS.slice(0, lines).map((key, index) => (
        <Skeleton
          key={key}
          variant="text"
          className={index === lines - 1 ? 'w-[62%]' : undefined}
        />
      ))}
    </div>
  );
}
