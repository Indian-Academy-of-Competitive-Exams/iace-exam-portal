import { useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { LogOut, User } from 'lucide-react';
import { cn } from '@iace/ui';

/**
 * Who is signed in, at the bottom of the sidebar, with the two things you do
 * from there: go to your profile, or leave.
 *
 * Bottom rather than top-right because that is where the identity belongs in a
 * sidebar shell — the top bar is for the brand and the theme, and putting the
 * account in both places invites the reader to wonder whether they differ.
 */
export function UserMenu({
  label,
  avatar,
  collapsed,
  profileHref,
  onProfile,
  onSignOut,
}: Readonly<{
  /** Email for an admin, mobile for a student — whatever names the account. */
  label: string;
  avatar?: ReactNode;
  collapsed: boolean;
  profileHref?: string;
  onProfile?: () => void;
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

          {profileHref !== undefined || onProfile ? (
            <a
              href={profileHref ?? '#'}
              onClick={(event) => {
                if (onProfile) {
                  event.preventDefault();
                  onProfile();
                }
                setOpen(false);
              }}
              className={item}
            >
              <User className="size-4 shrink-0" aria-hidden />
              Profile
            </a>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className={item}
          >
            <LogOut className="size-4 shrink-0" aria-hidden />
            Sign out
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
