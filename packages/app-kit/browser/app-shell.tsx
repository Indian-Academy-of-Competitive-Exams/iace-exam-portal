import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Menu, X } from 'lucide-react';
import {
  Brandmark,
  Button,
  PAGE_CONTENT_CLASS,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  ThemeToggle,
  cn,
} from '@iace/ui';
import { filterNavByPermission, type NavItem } from '../src';
import { SidebarNav } from './app-shell/sidebar-nav';
import { DrawerNav } from './app-shell/drawer-nav';
import { UserMenu } from './app-shell/user-menu';
import { DESKTOP_QUERY, useMediaQuery } from './app-shell/use-media-query';

/** How wide the content runs beside the sidebar. */
const WIDTHS = {
  narrow: 'max-w-5xl',
  wide: 'max-w-6xl',
} as const;

export type ShellWidth = keyof typeof WIDTHS;

export interface AppShellProps {
  /** The sections, in the order this app's user works through them. Empty means no nav at all. */
  nav: readonly NavItem[];
  children: ReactNode;
  onSignOut: () => void;
  /** Names the signed-in account — an email for an admin, a mobile for a student. */
  userLabel: string;
  /** Rendered in the user menu button; falls back to a generic person icon. */
  userAvatar?: ReactNode;
  /** Account screens above Log out. Leaves only; empty leaves just Log out. */
  userMenuItems?: readonly NavItem[];
  /** Named beside the mark — the admin app labels itself. */
  portal?: string;
  /** Beside the portal label, for anything the mark itself cannot carry. */
  brandSuffix?: ReactNode;
  /** Where the mark leads. It is the only way home: no nav row does that job. */
  homeTo?: string;
  /** Optional: an app with no permissions passes nothing and every section shows. */
  can?: (featureKey: string) => boolean;
  width?: ShellWidth;
}

/**
 * The signed-in chrome: top bar, sidebar, page. Desktop and mobile are different
 * components, not one markup styled twice — rendering both would give two tab orders.
 *
 * A fixed-height frame: the document never scrolls, the content region does. A page
 * can take that height for itself — see `TableFrame`.
 */
export function AppShell({
  nav,
  children,
  onSignOut,
  userLabel,
  userAvatar,
  userMenuItems,
  portal,
  brandSuffix,
  homeTo = '/',
  can,
  width = 'wide',
}: Readonly<AppShellProps>) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();

  const items = useMemo(() => filterNavByPermission(nav, can), [nav, can]);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // An app with one screen has nothing to navigate. Drawing the sidebar anyway
  // gives it an empty column, and the drawer a button that opens onto nothing.
  const hasNav = items.length > 0;

  const home = (
    <Link
      to={homeTo}
      className="flex min-w-0 items-center rounded-md focus-visible:shadow-focus focus-visible:outline-none"
    >
      <Brandmark portal={portal} />
    </Link>
  );

  return (
    // dvh, not vh: mobile browser chrome would crop the bottom of the frame.
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <header className="flex-none border-b border-border bg-surface">
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Mobile only: the sidebar's stand-in. On desktop the nav is always
              present, never behind a button. */}
          {hasNav && !isDesktop ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <Menu aria-hidden />
            </Button>
          ) : null}

          {home}
          {brandSuffix}

          {/* The account menu is here rather than under the nav so it survives an
              app with no sidebar. */}
          <div className="flex flex-1 items-center justify-end gap-1">
            <ThemeToggle />
            <UserMenu
              label={userLabel}
              avatar={userAvatar}
              items={userMenuItems}
              onSignOut={onSignOut}
            />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* A div, not an aside: the nav inside is the landmark, and wrapping it in
            a complementary one announces the same region twice. */}
        {isDesktop && hasNav ? (
          <div
            className={cn(
              // `relative` positions the collapse toggle that hangs off the edge.
              'relative flex h-full shrink-0 flex-col',
              'border-r border-border bg-surface p-[--sidebar-pad] transition-[width]',
              collapsed ? 'w-[--sidebar-w-rail]' : 'w-[--sidebar-w]',
            )}
          >
            {/* mt-8 clears the collapse toggle below, which hangs off the right
                edge at top-3 and is 24px tall: without it the first nav row sits
                level with the button and reads as attached to that item. */}
            <nav aria-label="Sections" className="mt-8 min-h-0 flex-1 overflow-y-auto">
              <SidebarNav items={items} pathname={pathname} collapsed={collapsed} />
            </nav>

            {/*
              On the divider, not in the sidebar. It acts on the boundary
              between nav and content, so that is where it belongs — and a
              full-width row inside the sidebar spent a whole line of the nav
              on a control that is used about twice a day.
            */}
            <button
              type="button"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((was) => !was)}
              className={cn(
                'absolute -right-3 top-3 grid size-6 place-items-center rounded-full',
                'border border-border bg-surface text-muted-foreground shadow-sm',
                'hover:bg-muted hover:text-foreground',
                'focus-visible:shadow-focus focus-visible:outline-none',
                'z-[--z-sticky]',
              )}
            >
              {collapsed ? (
                <ChevronRight className="size-3.5" aria-hidden />
              ) : (
                <ChevronLeft className="size-3.5" aria-hidden />
              )}
            </button>
          </div>
        ) : null}

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className={cn(PAGE_CONTENT_CLASS, WIDTHS[width])}>{children}</div>
        </main>
      </div>

      {/* Mobile only, so the two navs never coexist. A Sheet rather than an
          overlay and a panel: it owns the focus trap, Escape, the scroll lock
          and the return of focus to the hamburger — a drawer without those is
          one the reader can tab straight out of, into a page they cannot see. */}
      {hasNav && !isDesktop ? (
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          {/* aria-describedby={undefined}: the panel is a list of links and has
              nothing to describe. Radix otherwise warns in dev that a dialog
              without a description is probably missing one. */}
          <SheetContent side="left" showClose={false} aria-describedby={undefined}>
            <div className="mb-2 flex items-center justify-between">
              <Link to={homeTo} onClick={closeDrawer} className="rounded-md">
                <Brandmark />
              </Link>
              {/* The heading a screen reader announces on arrival. Hidden
                  because the logo beside it is the visible one. */}
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SheetClose asChild>
                <Button variant="ghost" size="sm" aria-label="Close navigation">
                  <X aria-hidden />
                </Button>
              </SheetClose>
            </div>

            <nav aria-label="Sections" className="min-h-0 flex-1 overflow-y-auto">
              <DrawerNav items={items} onNavigate={closeDrawer} />
            </nav>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}

export { type NavItem };
