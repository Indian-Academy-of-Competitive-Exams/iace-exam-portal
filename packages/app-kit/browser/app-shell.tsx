import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Menu, X } from 'lucide-react';
import { Brandmark, Button, ThemeToggle, cn } from '@iace/ui';
import { filterNavByPermission, type NavItem } from '../src';
import { SidebarNav } from './app-shell/sidebar-nav';
import { DrawerNav } from './app-shell/drawer-nav';
import { UserMenu } from './app-shell/user-menu';
import { DESKTOP_QUERY, useMediaQuery } from './app-shell/use-media-query';

/**
 * How wide the CONTENT runs beside the sidebar.
 *
 * A named choice rather than a class, because it is a real difference between
 * the two apps: a student arrives to do one thing, and a page running the full
 * width of a monitor makes finding it harder, not easier.
 */
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
  /**
   * Account screens listed in the user menu above Log out — profile, change
   * PIN, whatever this app has. Leaves only. Empty leaves just Log out.
   */
  userMenuItems?: readonly NavItem[];
  /** Beside the brandmark — the admin app labels itself. */
  brandSuffix?: ReactNode;
  /**
   * Permission check for `NavItem.featureKey`.
   *
   * Optional, and its absence is the degradation path: an app that has no
   * permissions (the student portal) passes nothing and every section shows.
   * See `filterNavByPermission` — hiding nav is not the security boundary.
   */
  can?: (featureKey: string) => boolean;
  width?: ShellWidth;
}

/**
 * The signed-in chrome: a top bar, a persistent left sidebar, and the page.
 *
 * Shared because it is chrome, and chrome that differs between two apps of one
 * platform reads as two products. What is genuinely per-app is injected — the
 * nav, who is signed in, the content width — which is the point of the split:
 * @iace/app-kit must not know that a route called "Groups" exists.
 *
 * The desktop and mobile structures are genuinely different components rather
 * than one markup styled two ways. Rendering both and hiding one with CSS would
 * put two focus traps and two tab orders in the document at once, one of them
 * invisible — which is how a keyboard user ends up tabbing into a drawer that
 * is not on screen.
 *
 * The CBT exam screen is deliberately NOT wrapped in this. A timed exam is
 * full-bleed and has its own chrome; a sidebar there is somewhere to click by
 * accident.
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
              // `sticky`, not `relative` — it is already a positioned ancestor,
              // so the edge button anchors to it. Adding `relative` too looks
              // harmless and is not: tailwind-merge drops one of two position
              // utilities, so the source would claim a class that never lands.
              'sticky top-[calc(var(--control-h-lg)+var(--space-4))] flex h-[calc(100vh-4rem)]',
              'shrink-0 flex-col border-r border-border bg-surface p-[--sidebar-pad] transition-[width]',
              collapsed ? 'w-[--sidebar-w-rail]' : 'w-[--sidebar-w]',
            )}
          >
            <nav className="min-h-0 flex-1 overflow-y-auto">
              <SidebarNav items={items} pathname={pathname} collapsed={collapsed} />
            </nav>

            <div className="mt-2 border-t border-border pt-2">{userMenu}</div>

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

      {/* Mobile drawer. Rendered only when open, so there is never an offscreen
          tab stop, and only on mobile, so the two navs never coexist. */}
      {!isDesktop && drawerOpen ? (
        <div className="fixed inset-0 z-[--z-drawer]">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-[--overlay-bg]"
            onClick={closeDrawer}
          />
          <div
            className={cn(
              'absolute inset-y-0 left-0 flex w-[--drawer-w] flex-col',
              'border-r border-border bg-surface p-[--sidebar-pad]',
            )}
          >
            <div className="mb-2 flex items-center justify-between">
              <Brandmark withWordmark />
              <Button variant="ghost" size="sm" aria-label="Close navigation" onClick={closeDrawer}>
                <X aria-hidden />
              </Button>
            </div>

            <nav aria-label="Sections" className="min-h-0 flex-1 overflow-y-auto">
              <DrawerNav items={items} onNavigate={closeDrawer} />
            </nav>

            <div className="mt-2 border-t border-border pt-2">{userMenu}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { type NavItem };
