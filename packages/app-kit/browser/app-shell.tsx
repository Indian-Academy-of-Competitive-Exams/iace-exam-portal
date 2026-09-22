import { type FeatureKey } from '@iace/contracts';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { WorkspaceContext } from './app-shell/use-workspace';
import { Menu, X } from 'lucide-react';
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
import { collapseLoneSections, filterNavByPermission, type NavItem } from '../src';
import { SidebarNav } from './app-shell/sidebar-nav';
import { NavBadgeProvider, type NavBadges } from './app-shell/nav-badges';
import { NavPanel } from './app-shell/nav-panel';
import { UserMenu } from './app-shell/user-menu';
import { DESKTOP_QUERY, useMediaQuery } from './app-shell/use-media-query';
import { useHoverOpen } from './app-shell/use-hover-open';

/** How wide the content runs beside the sidebar. `wide` caps sprawl, it does not create a margin. */
/** The skip link's target. One id, so the anchor and the landmark cannot drift apart. */
const MAIN_CONTENT_ID = 'main-content';

/** Long enough to cross the gap to a row's popover, short enough not to feel stuck open. */
const RAIL_CLOSE_MS = 250;

const WIDTHS = {
  narrow: 'max-w-5xl',
  wide: 'max-w-none',
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
  /** Before the theme toggle — a control that must be reachable from every screen. */
  headerEnd?: ReactNode;
  /** The only way home: no nav row does that job. */
  homeTo?: string;
  /** Optional: an app with no permissions passes nothing and every section shows. */
  can?: (featureKey: FeatureKey) => boolean;
  /** Counts a nav row wears, keyed by route — an unread tally belongs on its row, not in the bar. */
  navBadges?: NavBadges;
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
  headerEnd,
  homeTo = '/',
  can,
  navBadges,
  width = 'wide',
}: Readonly<AppShellProps>) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [panelOpen, setPanelOpen] = useState(false);
  const rail = useHoverOpen(RAIL_CLOSE_MS);
  // null: no workspace on screen. false: one, with the chrome. true: one that has taken the window.
  const [workspace, setWorkspace] = useState<boolean | null>(null);
  const { pathname } = useLocation();

  const items = useMemo(() => collapseLoneSections(filterNavByPermission(nav, can)), [nav, can]);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  const immersive = workspace === true;
  const hasNav = items.length > 0 && !immersive;

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
    <NavBadgeProvider badges={navBadges ?? {}}>
      <div className="flex h-dvh flex-col overflow-hidden bg-background">
        {/* `fixed`, not `absolute`: an sr-only child of a scrollport resolves against the page and grows it. */}
        <a
          href={`#${MAIN_CONTENT_ID}`}
          className={cn(
            'sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4',
            'focus-visible:z-[--z-toast] focus-visible:rounded-md focus-visible:border focus-visible:border-border',
            'focus-visible:bg-surface focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm',
            'focus-visible:font-medium focus-visible:text-foreground focus-visible:shadow-focus',
            'focus-visible:outline-none',
          )}
        >
          Skip to content
        </a>
        {immersive ? null : (
          <header className="flex-none border-b border-border bg-surface">
            <div className="flex items-center gap-3 px-4 py-2">
              {/* Below the rail there is no nav in the page at all, so the button is the only
              way in. Above it the rail is present and the toggle lives on its edge. */}
              {hasNav && !isDesktop ? (
                <Button
                  variant="ghost"
                  size="iconSm"
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
                {headerEnd}
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
        )}

        <div className="flex min-h-0 flex-1">
          {/* A div, not an aside: the nav inside is the landmark, and wrapping it in
            a complementary one announces the same region twice. */}
          {/* The rail is the only nav IN the flow, and its width never changes — which is what
            keeps the content region a constant. Pointing at it opens the panel over the top. */}
          {isDesktop && hasNav ? (
            // The spacer is the rail's width and never moves: what the page sees is a constant.
            <div className="relative w-[--sidebar-w-rail] shrink-0">
              <div
                // Pointer only: focus would swap the rows out from under the row that has focus.
                onPointerEnter={rail.onPointerEnter}
                onPointerLeave={rail.onPointerLeave}
                className={cn(
                  // Out of the flow and over the page: widening a flex sibling would reflow the content.
                  'absolute inset-y-0 left-0 z-[--z-drawer] flex flex-col overflow-hidden',
                  'border-r border-border bg-surface py-[--sidebar-rail-pad]',
                  'transition-[width,box-shadow] duration-200 ease-out motion-reduce:transition-none',
                  rail.open ? 'w-[--sidebar-w] shadow-[--shadow-overlay]' : 'w-[--sidebar-w-rail]',
                )}
              >
                {/* Held at the width it is FOR, so widening reveals the rows rather than reflowing them. */}
                <nav
                  aria-label="Sections"
                  className={cn(
                    'min-h-0 flex-1 shrink-0 overflow-y-auto px-[--sidebar-rail-pad]',
                    rail.open ? 'w-[--sidebar-w]' : 'w-[--sidebar-w-rail]',
                  )}
                >
                  {rail.open ? (
                    <NavPanel
                      items={items}
                      pathname={pathname}
                      drilldown={false}
                      onNavigate={rail.close}
                    />
                  ) : (
                    <SidebarNav items={items} pathname={pathname} collapsed />
                  )}
                </nav>
              </div>
            </div>
          ) : null}

          <main id={MAIN_CONTENT_ID} className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {/* No padding and no cap while immersive: the page asked for the window, not a column in it. */}
            <div
              className={
                workspace === null
                  ? cn(PAGE_CONTENT_CLASS, WIDTHS[width])
                  : 'flex min-h-0 w-full flex-1 flex-col overflow-hidden'
              }
            >
              <WorkspaceContext.Provider value={setWorkspace}>{children}</WorkspaceContext.Provider>
            </div>
          </main>
        </div>

        {/* Below the rail there is no nav in the page, so the drawer IS the nav: a Sheet, because
          it owns the focus trap, Escape and the return of focus to whatever opened it. */}
        {hasNav && !isDesktop ? (
          <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
            {/* aria-describedby={undefined}: the panel is a list of links and has
              nothing to describe. Radix otherwise warns in dev that a dialog
              without a description is probably missing one. */}
            <SheetContent aria-describedby={undefined} className="gap-5">
              {/* The lockup is a heading, not the first row of the list. */}
              <div className="flex items-center justify-between border-b border-border pb-3">
                <Link to={homeTo} onClick={closePanel} className="rounded-md">
                  <Brandmark />
                </Link>
                {/* The heading a screen reader announces on arrival. Hidden
                  because the logo beside it is the visible one. */}
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <SheetClose asChild>
                  <Button variant="ghost" size="iconSm" aria-label="Close navigation">
                    <X aria-hidden />
                  </Button>
                </SheetClose>
              </div>

              <nav aria-label="Sections" className="min-h-0 flex-1 overflow-y-auto">
                <NavPanel items={items} pathname={pathname} drilldown onNavigate={closePanel} />
              </nav>
            </SheetContent>
          </Sheet>
        ) : null}
      </div>
    </NavBadgeProvider>
  );
}

export { type NavItem };
