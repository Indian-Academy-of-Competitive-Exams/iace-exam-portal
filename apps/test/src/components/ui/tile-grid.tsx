import * as React from 'react';
import { Card, Metric, cn, type MetricProps } from '@iace/ui';

/** The supporting grid under a hero: tiles that wrap rather than a fixed count per row. */
export function TileGrid({
  children,
  className,
}: Readonly<{ children: React.ReactNode; className?: string }>) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface StatTileProps extends MetricProps {
  /** The value behind the headline — a best, a sample size, a cohort figure. */
  foot?: React.ReactNode;
}

export function StatTile({ foot, className, ...metric }: Readonly<StatTileProps>) {
  return (
    <Card className={cn('flex flex-col gap-1 p-5', className)}>
      <Metric size="md" {...metric} />
      {foot ? <span className="text-xs text-muted-foreground">{foot}</span> : null}
    </Card>
  );
}
