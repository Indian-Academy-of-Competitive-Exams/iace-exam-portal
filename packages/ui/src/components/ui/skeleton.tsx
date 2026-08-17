import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Placeholders shaped like the content coming. Use above ~300ms only; below that it flashes.
 * Match the real shape, or the layout jumps when the data lands.
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
        // The global reduced-motion rule only shortens, which would park the sheen mid-element.
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

/** A paragraph on its way. The last line is short, as a real one is. */
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
