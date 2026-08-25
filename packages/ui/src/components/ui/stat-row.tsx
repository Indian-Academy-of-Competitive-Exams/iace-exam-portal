import * as React from 'react';
import { cn } from '../../lib/utils';

export interface StatRowProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  /** Tabular figures, so stacked rows line up. */
  value: React.ReactNode;
}

/** One labelled number in a stacked summary. */
export function StatRow({ label, value, className, ...props }: Readonly<StatRowProps>) {
  return (
    // Sized here, or it renders at whatever the page it landed in happens to inherit.
    <div className={cn('flex items-center justify-between gap-4 text-sm', className)} {...props}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}
