import * as React from 'react';
import { Card, MetricGroup, cn } from '@iace/ui';

/** The standing, as one card parted by hairlines rather than a row of floating tiles. */
export function StatBand({
  children,
  className,
}: Readonly<{ children: React.ReactNode; className?: string }>) {
  return (
    <Card className={cn('p-5', className)}>
      <MetricGroup>{children}</MetricGroup>
    </Card>
  );
}
