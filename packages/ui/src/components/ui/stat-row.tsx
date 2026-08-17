import * as React from 'react';
import { cn } from '../../lib/utils';

export interface StatRowProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  /**
   * Rendered in tabular figures, because these stack: "Rows read 1,858" above
   * "New students 214" only lines up if the digits are the same width.
   */
  value: React.ReactNode;
}

/**
 * One labelled number in a stacked summary — what an import would do, what a
 * score card totals.
 *
 * The label is quiet and the number is not, because the number is the thing
 * being read; the label only says which number it is.
 */
export function StatRow({ label, value, className, ...props }: Readonly<StatRowProps>) {
  return (
    <div className={cn('flex items-center justify-between gap-4', className)} {...props}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}
