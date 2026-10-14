import * as React from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SectionHeadingProps {
  /** The plain noun for the region below. Never a phrase, never a pronoun. */
  title: string;
  level?: 2 | 3;
  /** One muted glyph ahead of the title. */
  icon?: LucideIcon;
  /** A value the region carries — a count, a name. Never a sentence about it. */
  meta?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

const HEADING_TAG = { 2: 'h2', 3: 'h3' } as const;

/** Two tiers, not one style twice — level 3 reads as subordinate to level 2, not a peer of it. */
const HEADING_CLASS = {
  2: 'text-md font-semibold tracking-tight text-foreground',
  3: 'text-xs font-semibold uppercase tracking-wide text-muted-foreground',
} as const;

export function SectionHeading({
  title,
  level = 2,
  icon: Icon,
  meta,
  action,
  className,
}: Readonly<SectionHeadingProps>) {
  const Tag = HEADING_TAG[level];

  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-3 gap-y-1', className)}>
      <Tag className={cn(HEADING_CLASS[level], Icon && 'inline-flex items-center gap-2')}>
        {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
        {title}
      </Tag>
      {meta ? <span className="text-sm text-muted-foreground">{meta}</span> : null}
      {action ? <span className="ml-auto">{action}</span> : null}
    </div>
  );
}
