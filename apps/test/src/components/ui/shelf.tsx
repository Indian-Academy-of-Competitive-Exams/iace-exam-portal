import * as React from 'react';
import { cn } from '@iace/ui';

export interface ShelfProps {
  /** The plain noun for the shelf, and the way into it — a series name that is its own link. */
  title: React.ReactNode;
  /** The values behind it — how many, how far through. Never a sentence. */
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** A shelf scrolls SIDEWAYS inside the page's vertical scroll — a different axis hides nothing. */
export function Shelf({ title, meta, children, className }: Readonly<ShelfProps>) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-4', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        {title}
        {meta ? <span className="text-sm text-muted-foreground">{meta}</span> : null}
      </div>
      <div className="relative flex snap-x gap-4 overflow-x-auto pb-2">{children}</div>
    </section>
  );
}
