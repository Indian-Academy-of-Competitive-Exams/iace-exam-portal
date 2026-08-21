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
 * Who is signed in, in the top bar, with the account screens and Log out.
 * A menu rather than a popover, so it announces a count and answers the arrow keys.
 */
export function UserMenu({
  label,
  avatar,
  items = [],
  onSignOut,
}: Readonly<{
  /** Email for an admin, mobile for a student — whatever names the account. */
  label: string;
  avatar?: ReactNode;
  /** Account screens, in menu order. Leaves only — `to` is required here. */
  items?: readonly NavItem[];
  onSignOut: () => void;
}>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
            // Capped rather than fluid: an email long enough to matter would
            // otherwise push the theme toggle off the bar on a narrow screen.
            'max-w-[12rem] shrink-0',
            'text-foreground-secondary hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none',
          )}
        >
          {avatar ?? <User className="size-4 shrink-0" aria-hidden />}
          <span className="hidden min-w-0 truncate sm:block">{label}</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="bottom" align="end" className="min-w-56">
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
