import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Menu, X } from 'lucide-react';
import {
  Brandmark,
  Button,
  Separator,
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
  /** The sections, in the order this app's user works through them. */
  nav: readonly NavItem[];
  children: ReactNode;
  onSignOut: () => void;
  /** Names the signed-in account — an email for an admin, a mobile for a student. */
  userLabel: string;
  /** Rendered in the user menu button; falls back to a generic person icon. */
  userAvatar?: ReactNode;
  /** Account screens above Log out. Leaves only; empty leaves just Log out. */
  userMenuItems?: readonly NavItem[];
  /** Beside the brandmark — the admin app labels itself. */
  brandSuffix?: ReactNode;
  /** Optional: an app with no permissions passes nothing and every section shows. */
  can?: (featureKey: string) => boolean;
  width?: ShellWidth;
}

/**
 * The signed-in chrome: top bar, sidebar, page. Desktop and mobile are different
 * components, not one markup styled twice — rendering both would give two tab orders.
 */
export function AppShell({
  nav,
  children,
  onSignOut,
  userLabel,
  userAvatar,
  userMenuItems,
  brandSuffix,
  can,
  width = 'wide',
}: Readonly<AppShellProps>) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();

  const items = useMemo(() => filterNavByPermission(nav, can), [nav, can]);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const userMenu = (
    <UserMenu
      label={userLabel}
      avatar={userAvatar}
      collapsed={isDesktop && collapsed}
      items={userMenuItems}
      onSignOut={onSignOut}
    />
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-[--z-sticky] border-b border-border bg-surface/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Mobile only: the sidebar's stand-in. On desktop the nav is always
              present, never behind a button. */}
          {!isDesktop ? (
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

          <div className="flex min-w-0 items-center gap-3">
            <Brandmark withWordmark />
            {brandSuffix}
          </div>

          <div className="flex flex-1 items-center justify-end">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="flex">
        {isDesktop ? (
          <aside
            aria-label="Sections"
            className={cn(
              // `sticky` is already the positioned ancestor; adding `relative` makes
              // tailwind-merge drop one of the two.
              'sticky top-[calc(var(--control-h-lg)+var(--space-4))] flex h-[calc(100vh-4rem)]',
              'shrink-0 flex-col border-r border-border bg-surface p-[--sidebar-pad] transition-[width]',
              collapsed ? 'w-[--sidebar-w-rail]' : 'w-[--sidebar-w]',
            )}
          >
            <nav className="min-h-0 flex-1 overflow-y-auto">
              <SidebarNav items={items} pathname={pathname} collapsed={collapsed} />
            </nav>

            <Separator className="my-2" />
            {userMenu}

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
          </aside>
        ) : null}

        <main className="min-w-0 flex-1">
          <div className={cn('mx-auto px-5 py-8', WIDTHS[width])}>{children}</div>
        </main>
      </div>

      {/* Mobile only, so the two navs never coexist. A Sheet rather than an
          overlay and a panel: it owns the focus trap, Escape, the scroll lock
          and the return of focus to the hamburger — a drawer without those is
          one the reader can tab straight out of, into a page they cannot see. */}
      {!isDesktop ? (
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          {/* aria-describedby={undefined}: the panel is a list of links and has
              nothing to describe. Radix otherwise warns in dev that a dialog
              without a description is probably missing one. */}
          <SheetContent side="left" showClose={false} aria-describedby={undefined}>
            <div className="mb-2 flex items-center justify-between">
              <Brandmark withWordmark />
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

            <Separator className="my-2" />
            {userMenu}
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}

export { type NavItem };
