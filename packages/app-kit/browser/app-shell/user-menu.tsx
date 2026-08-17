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
 * Who is signed in, at the bottom of the sidebar, with the account screens and Log out.
 * A menu rather than a popover, so it announces a count and answers the arrow keys.
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
            'flex items-center gap-2 rounded-md text-sm',
            'text-foreground-secondary hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none',
            collapsed
              ? // A circle wider than the avatar, so the hover tint reads as a ring
                // around it. `px-0` left the background exactly the avatar's width,
                // touching its border on both sides; and a rounded-md box behind a
                // round image is two different shapes fighting.
                'size-10 shrink-0 justify-center self-center rounded-full'
              : 'w-full px-2 py-2',
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
