import * as React from 'react';
import { Card, cn } from '@iace/ui';

export interface SurfaceCardProps {
  /** The plain noun for what the card holds. Omitted where the content names itself. */
  title?: string;
  /** A value the card carries — a count, a mode, a scope. Never a sentence. */
  meta?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** One card at `--pad-card`, the student grid's unit. Never nested inside another card. */
export function SurfaceCard({
  title,
  meta,
  action,
  children,
  className,
}: Readonly<SurfaceCardProps>) {
  return (
    <Card className={cn('flex min-w-0 flex-col gap-4 p-5', className)}>
      {title ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-md font-semibold tracking-tight text-foreground">{title}</h2>
          {meta ? <span className="text-sm text-muted-foreground">{meta}</span> : null}
          {action ? <span className="ml-auto">{action}</span> : null}
        </div>
      ) : null}
      {children}
    </Card>
  );
}
