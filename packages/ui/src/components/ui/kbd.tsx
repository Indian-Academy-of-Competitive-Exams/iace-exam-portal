import * as React from 'react';
import { cn } from '../../lib/utils';

export interface KbdProps {
  children: React.ReactNode;
  className?: string;
}

/** One key, drawn as a key. A shortcut written as plain text reads as part of the sentence. */
export function Kbd({ children, className }: Readonly<KbdProps>) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-[1.5rem] items-center justify-center rounded border border-border',
        'bg-surface px-1.5 py-0.5 font-mono text-[0.6875rem] leading-none text-foreground-secondary',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
