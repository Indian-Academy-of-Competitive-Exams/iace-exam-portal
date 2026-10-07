import * as React from 'react';
import { cn } from '../../lib/utils';

export interface MetricGroupProps {
  /** Two to four <Metric>. Beyond that it is a table, not a headline. */
  children: React.ReactNode;
  className?: string;
}

export function MetricGroup({ children, className }: Readonly<MetricGroupProps>) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-x-4 gap-y-5 sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none sm:gap-0',
        'sm:divide-x sm:divide-border',
        'sm:[&>*]:px-6 sm:[&>*:first-child]:pl-0 sm:[&>*:last-child]:pr-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
