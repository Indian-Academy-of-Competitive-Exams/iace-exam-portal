import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const TONES = {
  default: 'text-foreground',
  positive: 'text-success-ink',
  caution: 'text-warning-ink',
} as const;

export type MetricTone = keyof typeof TONES;
export type MetricSize = 'md' | 'lg';

const metricValue = cva('font-semibold tabular-nums tracking-tight', {
  variants: {
    size: { md: 'text-2xl', lg: 'text-3xl' },
    tone: TONES,
  },
  defaultVariants: { size: 'lg', tone: 'default' },
});

export interface MetricProps {
  /** The plain noun for the value, set as an overline above it. */
  label: string;
  value: React.ReactNode;
  /** A VALUE qualifying the number — "/ 100", "%", "of 340". Never a sentence. */
  unit?: React.ReactNode;
  tone?: MetricTone;
  size?: MetricSize;
  icon?: React.ReactNode;
  className?: string;
}

export function Metric({ label, value, unit, tone, size, icon, className }: Readonly<MetricProps>) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className={metricValue({ size, tone })}>{value}</span>
        {unit ? <span className="text-md text-muted-foreground">{unit}</span> : null}
      </span>
    </div>
  );
}
