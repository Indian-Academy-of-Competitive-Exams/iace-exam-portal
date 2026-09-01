import type * as React from 'react';
import { cn } from '../../lib/utils';
import { SectionHeading } from '../ui/section-heading';

export interface ChartFigureProps {
  title: string;
  /** A value the plot carries, never a sentence about what the plot is. */
  meta?: React.ReactNode;
  /** The headline the chart is read for, set against the title. */
  figure?: React.ReactNode;
  legend?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** A region of the page, not a tile: only the surface the dataviz palette was validated against. */
export function ChartFigure({
  title,
  meta,
  figure,
  legend,
  children,
  className,
}: Readonly<ChartFigureProps>) {
  return (
    <figure className={cn('flex flex-col gap-3 rounded-lg bg-chart-surface p-4', className)}>
      <figcaption className="flex items-start justify-between gap-4">
        <SectionHeading className="min-w-0" title={title} meta={meta} />
        {figure ? <div className="shrink-0">{figure}</div> : null}
      </figcaption>
      {legend}
      {children}
    </figure>
  );
}
