import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { LogOut, User } from 'lucide-react';
import { cn } from '@iace/ui';
import { type NavItem } from '../../src';

/**
 * Who is signed in, at the bottom of the sidebar, with the things you do from
 * there: the account screens this app has, and leaving.
 *
 * Bottom rather than top-right because that is where the identity belongs in a
 * sidebar shell — the top bar is for the brand and the theme, and putting the
 * account in both places invites the reader to wonder whether they differ.
 *
 * The entries are a list rather than a fixed Profile link because what belongs
 * to an account differs per app: a student has a profile AND a PIN to change,
 * an admin signs in with an emailed code and has neither.
 */
export function UserMenu({
  label,
  avatar,
  collapsed,
  items = [],
  onSignOut,
}: Readonly<{
  /** Email for an admin, mobile for a student — whatever names the account. */
  label: string;
  avatar?: ReactNode;
  collapsed: boolean;
  /** Account screens, in menu order. Leaves only — `to` is required here. */
  items?: readonly NavItem[];
  onSignOut: () => void;
}>) {
  const [open, setOpen] = useState(false);

  const item = cn(
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
    'text-foreground hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none',
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={collapsed ? label : undefined}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm',
            'text-foreground-secondary hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none',
            collapsed && 'justify-center px-0',
          )}
        >
          {avatar ?? <User className="size-4 shrink-0" aria-hidden />}
          {collapsed ? (
            <span className="sr-only">{label}</span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className={cn(
            'z-[--z-popover] min-w-56 rounded-lg border border-border bg-surface p-1 shadow-lg',
          )}
        >
          <p className="truncate px-2 py-1.5 text-xs text-muted-foreground">{label}</p>

          {/* Link, not <a href>: an anchor reloads the SPA, which throws away
              the query cache to move between two screens of the same app. */}
          {items.map((entry) => (
            <Link
              key={entry.label}
              to={entry.to ?? ''}
              onClick={() => setOpen(false)}
              className={item}
            >
              {entry.icon ? <entry.icon className="size-4 shrink-0" aria-hidden /> : null}
              {entry.label}
            </Link>
          ))}

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className={item}
          >
            <LogOut className="size-4 shrink-0" aria-hidden />
            Log out
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
