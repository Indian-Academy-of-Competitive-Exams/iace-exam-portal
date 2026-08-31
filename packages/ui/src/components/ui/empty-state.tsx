import * as React from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

const HEADING_TAG = { 2: 'h2', 3: 'h3' } as const;

export interface EmptyStateProps {
  icon: LucideIcon;
  /** The plain noun for what is absent — "No tests yet". Never a sentence about the reader. */
  title: string;
  /** A rule or consequence they cannot infer; call sites must justify it with `ui-copy-ok`. */
  hint?: string;
  action?: React.ReactNode;
  /** Set to 3 when nested under a `SectionHeading` — never two `h2`s in one region. */
  level?: 2 | 3;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  level = 2,
  className,
}: Readonly<EmptyStateProps>) {
  const Tag = HEADING_TAG[level];

  return (
    <div
      className={cn(
        'mx-auto flex max-w-[var(--empty-max-w)] flex-col items-center gap-3 p-[var(--empty-pad)] text-center',
        className,
      )}
    >
      <span
        aria-hidden
        className="flex size-12 items-center justify-center rounded-full bg-[var(--empty-icon-bg)]"
      >
        <Icon className="size-6 text-[var(--empty-icon)]" />
      </span>
      <Tag className="text-md font-semibold text-foreground">{title}</Tag>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      {action}
    </div>
  );
}
