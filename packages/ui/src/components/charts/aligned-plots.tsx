import type * as React from 'react';
import { cn } from '../../lib/utils';

export interface AlignedPlotsProps {
  primary: React.ReactNode;
  secondary: React.ReactNode;
  /** The plain noun for what the lower plot measures. */
  secondaryLabel: string;
  className?: string;
}

/** Two measures of different scale, stacked on one x — never two y-axes on one plot. */
export function AlignedPlots({
  primary,
  secondary,
  secondaryLabel,
  className,
}: Readonly<AlignedPlotsProps>) {
  return (
    <div className={cn('flex flex-col', className)}>
      {primary}
      <div className="mt-2 border-t border-border pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {secondaryLabel}
        </p>
      </div>
      {secondary}
    </div>
  );
}
