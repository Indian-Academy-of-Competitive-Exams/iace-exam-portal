import * as React from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface EmptyStateProps {
  icon: LucideIcon;
  /** The plain noun for what is absent — "No tests yet". Never a sentence about the reader. */
  title: string;
  /** A rule or consequence they cannot infer; call sites must justify it with `ui-copy-ok`. */
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: Readonly<EmptyStateProps>) {
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
      <h2 className="text-md font-semibold text-foreground">{title}</h2>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      {action}
    </div>
  );
}
