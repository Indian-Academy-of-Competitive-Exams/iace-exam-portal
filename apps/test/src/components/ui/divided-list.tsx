import * as React from 'react';
import { Card, cn } from '@iace/ui';

/** Rows in ONE card, parted by hairlines — the student answer to a stack of little cards. */
export function DividedList({
  children,
  className,
}: Readonly<{ children: React.ReactNode; className?: string }>) {
  return (
    <Card className={cn('flex min-w-0 flex-col divide-y divide-border', className)}>
      {children}
    </Card>
  );
}

export interface DividedRowProps {
  /** The row's overline — its state, in the exam world's own words. */
  lead?: React.ReactNode;
  title: React.ReactNode;
  /** The values behind the title — counts, marks, a time. Never a sentence. */
  meta?: React.ReactNode;
  /** The one thing this row does. */
  action?: React.ReactNode;
  className?: string;
}

export function DividedRow({ lead, title, meta, action, className }: Readonly<DividedRowProps>) {
  return (
    <div
      className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-4', className)}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        {lead}
        <span className="truncate text-base font-semibold text-foreground">{title}</span>
        {meta ? <span className="text-sm text-muted-foreground">{meta}</span> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
