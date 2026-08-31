import type * as React from 'react';
import { cn } from '../../lib/utils';
import { Card } from '../ui/card';

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

/** A chart sits on the chart surface the palette was validated against, not the page's. */
export function ChartFigure({
  title,
  meta,
  figure,
  legend,
  children,
  className,
}: Readonly<ChartFigureProps>) {
  return (
    <Card className={cn('bg-chart-surface p-5', className)}>
      <figure className="flex flex-col gap-3">
        <figcaption className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {meta ? <div className="mt-0.5 text-xs text-muted-foreground">{meta}</div> : null}
          </div>
          {figure ? <div className="shrink-0 text-right">{figure}</div> : null}
        </figcaption>
        {legend}
        {children}
      </figure>
    </Card>
  );
}
