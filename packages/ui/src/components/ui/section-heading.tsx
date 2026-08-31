import * as React from 'react';
import { cn } from '../../lib/utils';

export interface SectionHeadingProps {
  /** The plain noun for the region below. Never a phrase, never a pronoun. */
  title: string;
  level?: 2 | 3;
  /** A value the region carries — a count, a name. Never a sentence about it. */
  meta?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function SectionHeading({
  title,
  level = 2,
  meta,
  action,
  className,
}: Readonly<SectionHeadingProps>) {
  const Tag = level === 2 ? 'h2' : 'h3';

  return (
    <div className={cn('flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1', className)}>
      <Tag className="text-md font-semibold tracking-tight text-foreground">{title}</Tag>
      {meta ? <span className="text-sm tabular-nums text-muted-foreground">{meta}</span> : null}
      {action}
    </div>
  );
}
