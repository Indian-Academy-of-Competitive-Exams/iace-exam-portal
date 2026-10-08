import * as React from 'react';
import { cn } from '../../lib/utils';

const IS_MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

/** A Mac prints Cmd and Option where every other keyboard prints Ctrl and Alt. */
export const KEY_NAMES = { MOD: IS_MAC ? 'Cmd' : 'Ctrl', ALT: IS_MAC ? 'Option' : 'Alt' } as const;

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

export interface ShortcutProps {
  /** Pressed together, or typed as one run when there is only one. */
  keys: readonly string[];
  /** What it gives. */
  children: React.ReactNode;
  className?: string;
}

/** The keys, then what they give. */
export function Shortcut({ keys, children, className }: Readonly<ShortcutProps>) {
  return (
    <span className={cn('flex flex-none items-center gap-1', className)}>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
      <span>{children}</span>
    </span>
  );
}
