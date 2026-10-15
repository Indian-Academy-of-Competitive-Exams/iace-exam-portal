import * as React from 'react';
import { cn } from '@iace/ui';
import { NavBadgeContext, type NavBadges } from './nav-badge-context';

export function NavBadgeProvider({
  badges,
  children,
}: Readonly<{ badges: NavBadges; children: React.ReactNode }>) {
  return <NavBadgeContext value={badges}>{children}</NavBadgeContext>;
}

/** Past this the count stops being a number and becomes "a lot", which is all it has to say. */
const MAX_SHOWN = 9;

export function NavBadge({ count, collapsed }: Readonly<{ count: number; collapsed: boolean }>) {
  if (count <= 0) return null;
  const shown = count > MAX_SHOWN ? `${MAX_SHOWN}+` : String(count);

  return (
    <span
      aria-hidden
      className={cn(
        'flex items-center justify-center rounded-full bg-primary font-medium leading-none text-primary-foreground',
        // Superscript: `h-4` was the size of the very glyph it sat on, so it covered it.
        collapsed
          ? 'absolute -end-2 -top-2 h-3.5 min-w-3.5 px-1 text-[0.5625rem] ring-2 ring-surface'
          : 'ms-auto h-4 min-w-4 px-1 text-[0.625rem]',
      )}
    >
      {shown}
    </span>
  );
}
