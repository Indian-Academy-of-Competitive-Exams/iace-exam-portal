import { cn } from '@iace/ui';
import { type NavItem } from '../../src';
import { NavPanel } from './nav-panel';
import { SidebarNav } from './sidebar-nav';
import { useHoverOpen } from './use-hover-open';

/** Long enough to cross the gap to a row's popover, short enough not to feel stuck open. */
const CLOSE_MS = 250;

/** The only nav in the layout flow. Pointing at it widens it OVER the page, never beside it. */
export function DesktopRail({
  items,
  pathname,
}: Readonly<{ items: readonly NavItem[]; pathname: string }>) {
  const rail = useHoverOpen(CLOSE_MS);

  return (
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
            <NavPanel items={items} pathname={pathname} drilldown={false} onNavigate={rail.close} />
          ) : (
            <SidebarNav items={items} pathname={pathname} collapsed />
          )}
        </nav>
      </div>
    </div>
  );
}
