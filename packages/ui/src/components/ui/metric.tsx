import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

export type MetricSize = 'md' | 'lg';

const metricValue = cva('font-semibold tabular-nums tracking-tight text-foreground', {
  variants: {
    size: { md: 'text-2xl', lg: 'text-3xl' },
  },
  defaultVariants: { size: 'lg' },
});

export interface MetricProps {
  /** The plain noun for the value, set as an overline above it. */
  label: string;
  value: React.ReactNode;
  /** A VALUE qualifying the number — "/ 100", "%", "of 340". Never a sentence. */
  unit?: React.ReactNode;
  size?: MetricSize;
  className?: string;
}

export function Metric({ label, value, unit, size, className }: Readonly<MetricProps>) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className={metricValue({ size })}>{value}</span>
        {unit ? <span className="text-md text-muted-foreground">{unit}</span> : null}
      </span>
    </div>
  );
}
