import { type ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { Brandmark, Button, ThemeToggle, cn } from '@iace/ui';

export interface NavItem {
  to: string;
  label: string;
}

/**
 * How wide the content runs.
 *
 * A named choice rather than a class, because it is the one real difference
 * between the shells and it is a decision: the student portal is deliberately
 * narrower — a student arrives to do one thing, and a page that runs the full
 * width of a desktop monitor makes finding it harder, not easier.
 */
const WIDTHS = {
  narrow: 'max-w-5xl',
  wide: 'max-w-6xl',
} as const;

export type ShellWidth = keyof typeof WIDTHS;

export interface AppShellProps {
  /** The tabs, in the order this app's user works through them. */
  nav: readonly NavItem[];
  /** Rendered in `<main>`. Usually `<Outlet />`, sometimes a gate in front of it. */
  children: ReactNode;
  onSignOut: () => void;
  /** Beside the brandmark — the admin app labels itself. */
  brandSuffix?: ReactNode;
  /** Who is signed in, however this app wants to say it. */
  identity?: ReactNode;
  width?: ShellWidth;
}

/**
 * The signed-in chrome: one header, one nav, and the page below it.
 *
 * Shared because it is chrome, and chrome that differs between two apps of one
 * platform reads as two products. What is genuinely per-app is injected: the
 * nav items, how the identity is shown (a student sees their photo and name, an
 * admin their email and whether they are a super admin), and the width.
 *
 * `nav` is a prop rather than an import, which is the point of the split —
 * @iace/app-kit must not know that a route called "Groups" exists.
 */
export function AppShell({
  nav,
  children,
  onSignOut,
  brandSuffix,
  identity,
  width = 'wide',
}: Readonly<AppShellProps>) {
  const container = cn('mx-auto', WIDTHS[width]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
        <div className={cn(container, 'flex items-center justify-between gap-4 px-5 py-3')}>
          <div className="flex items-center gap-3">
            <Brandmark withWordmark />
            {brandSuffix}
          </div>

          <div className="flex items-center gap-2">
            {identity}
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={onSignOut}>
              <LogOut aria-hidden />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>

        <nav className={cn(container, 'flex gap-1 px-4')} aria-label="Sections">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              // Without `end`, the home route matches every path and both tabs
              // light up at once.
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  'focus-visible:shadow-focus focus-visible:outline-none',
                  isActive
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className={cn(container, 'px-5 py-8')}>{children}</main>
    </div>
  );
}
