import { type FeatureKey } from '@iace/contracts';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Menu, X } from 'lucide-react';
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
import { NavPanel } from './app-shell/nav-panel';
import { UserMenu } from './app-shell/user-menu';
import { DESKTOP_QUERY, useMediaQuery } from './app-shell/use-media-query';

/** How wide the content runs beside the sidebar. */
const WIDTHS = {
  narrow: 'max-w-5xl',
  wide: 'max-w-6xl',
} as const;

export type ShellWidth = keyof typeof WIDTHS;

export interface AppShellProps {
  /** In the order this app's user works through them. Empty draws no sidebar and no drawer. */
  nav: readonly NavItem[];
  children: ReactNode;
  onSignOut: () => void;
  /** Names the signed-in account — an email for an admin, a mobile for a student. */
  userLabel: string;
  /** Rendered in the user menu button; falls back to a generic person icon. */
  userAvatar?: ReactNode;
  /** Account screens above Log out. Leaves only; empty leaves just Log out. */
  userMenuItems?: readonly NavItem[];
  portal?: string;
  /** Beside the portal label — the admin's Super admin badge. */
  brandSuffix?: ReactNode;
  /** The only way home: no nav row does that job. */
  homeTo?: string;
  /** Optional: an app with no permissions passes nothing and every section shows. */
  can?: (featureKey: FeatureKey) => boolean;
  width?: ShellWidth;
}

/**
 * The signed-in chrome: top bar, sidebar, page. Desktop and mobile are different
 * components, not one markup styled twice — rendering both would give two tab orders.
 * A fixed-height frame: the document never scrolls, the content region does.
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
  const [panelOpen, setPanelOpen] = useState(false);
  const { pathname } = useLocation();

  const items = useMemo(() => filterNavByPermission(nav, can), [nav, can]);
  const closePanel = useCallback(() => setPanelOpen(false), []);

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
          {/* Below the rail there is no nav in the page at all, so the button is the only
              way in. Above it the rail is present and the toggle lives on its edge. */}
          {hasNav && !isDesktop ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Open navigation"
              aria-expanded={panelOpen}
              onClick={() => setPanelOpen(true)}
            >
              <Menu aria-hidden />
            </Button>
          ) : null}

          {home}
          {brandSuffix}

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
        {/* The rail is the only nav IN the flow, and its width never changes — which is what
            keeps the content region a constant. Expanding opens the panel over the top. */}
        {isDesktop && hasNav ? (
          <div
            className={cn(
              // `relative` positions the expand toggle that hangs off the edge.
              'relative flex h-full w-[--sidebar-w-rail] shrink-0 flex-col',
              'border-r border-border bg-surface p-[--sidebar-pad]',
            )}
          >
            {/* mt-8 clears the toggle below, which hangs off the right edge at top-3 and is
                24px tall: without it the first nav row reads as attached to that button. */}
            <nav aria-label="Sections" className="mt-8 min-h-0 flex-1 overflow-y-auto">
              <SidebarNav items={items} pathname={pathname} collapsed />
            </nav>

            <button
              type="button"
              aria-label="Open navigation"
              aria-expanded={panelOpen}
              onClick={() => setPanelOpen(true)}
              className={cn(
                'absolute -right-3 top-3 grid size-6 place-items-center rounded-full',
                'border border-border bg-surface text-muted-foreground shadow-sm',
                'hover:bg-muted hover:text-foreground',
                'focus-visible:shadow-focus focus-visible:outline-none',
                'z-[--z-sticky]',
              )}
            >
              <ChevronRight className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : null}

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className={cn(PAGE_CONTENT_CLASS, WIDTHS[width])}>{children}</div>
        </main>
      </div>

      {/* Every breakpoint, not just the small one. A Sheet rather than a hand-rolled panel: it
          owns the focus trap, Escape, the scroll lock and the return of focus to whatever
          opened it, and being portalled is what keeps the content region from ever reflowing. */}
      {hasNav ? (
        <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
          {/* aria-describedby={undefined}: the panel is a list of links and has
              nothing to describe. Radix otherwise warns in dev that a dialog
              without a description is probably missing one. */}
          <SheetContent side="left" showClose={false} aria-describedby={undefined}>
            {/* The lockup is a heading, not the first row of the list. */}
            <div className="mb-5 flex items-center justify-between border-b border-border pb-3">
              <Link to={homeTo} onClick={closePanel} className="rounded-md">
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
              <NavPanel
                items={items}
                pathname={pathname}
                drilldown={!isDesktop}
                onNavigate={closePanel}
              />
            </nav>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}

export { type NavItem };
