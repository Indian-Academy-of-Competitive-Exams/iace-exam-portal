import * as React from 'react';
import { cn } from '@iace/ui';

export interface ShelfProps {
  /** The plain noun for the shelf — a series name, a bucket. */
  title: React.ReactNode;
  /** The values behind it — how many, how far through. Never a sentence. */
  meta?: React.ReactNode;
  /** The way into the whole of what this shows. */
  action?: React.ReactNode;
  /** Sits under the heading, above the track — a progress bar, a banner. */
  banner?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** A shelf scrolls SIDEWAYS inside the page's vertical scroll — a different axis hides nothing. */
export function Shelf({ title, meta, action, banner, children, className }: Readonly<ShelfProps>) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-4', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          {title}
          {meta ? <span className="text-sm text-muted-foreground">{meta}</span> : null}
        </div>
        {action}
      </div>
      {banner}
      <div className="relative flex snap-x gap-4 overflow-x-auto pb-2">{children}</div>
    </section>
  );
}
