import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, User } from 'lucide-react';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@iace/ui';
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
 *
 * A menu, not a popover holding links. The popover it used to be closed on
 * Escape and on a click outside — but it was an anonymous box: it announced no
 * count and no position, and the arrow keys did nothing in it. This is a list
 * of choices, so it says so.
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
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
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" className="min-w-56">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>

        {/* Link, not <a href>: an anchor reloads the SPA, which throws away the
            query cache to move between two screens of the same app. */}
        {items.map((entry) => (
          <DropdownMenuItem key={entry.label} asChild>
            <Link to={entry.to ?? ''}>
              {entry.icon ? <entry.icon className="size-4 shrink-0" aria-hidden /> : null}
              {entry.label}
            </Link>
          </DropdownMenuItem>
        ))}

        {items.length > 0 ? <DropdownMenuSeparator /> : null}

        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut className="size-4 shrink-0" aria-hidden />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
