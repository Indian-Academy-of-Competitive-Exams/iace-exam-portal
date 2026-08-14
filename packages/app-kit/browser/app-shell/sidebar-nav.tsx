import { useId, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@iace/ui';
import {
  NAV_LAYOUT,
  isNavItemActive,
  isNavSection,
  resolveNavLayout,
  type NavItem,
} from '../../src';

/**
 * One row in the sidebar, whatever it turns out to be.
 *
 * The chevron is the contract with the reader: **down means it expands below,
 * right means a panel opens beside**. Getting that wrong is worse than having
 * no affordance, because the reader braces for the wrong thing — a sidebar
 * that jumps when they expected a panel has moved the item they were aiming at.
 */
const ROW = [
  'flex w-full items-center gap-3 rounded-md px-3 text-sm font-medium',
  'h-[--nav-item-h] transition-colors',
  'focus-visible:shadow-focus focus-visible:outline-none',
].join(' ');

const ROW_IDLE = 'text-muted-foreground hover:bg-muted hover:text-foreground';
const ROW_ACTIVE = 'bg-primary-subtle text-primary-ink';

function Glyph({ item, collapsed }: Readonly<{ item: NavItem; collapsed: boolean }>) {
  const Icon = item.icon;
  if (Icon) return <Icon className="size-4 shrink-0" aria-hidden />;
  // A rail with no icon would be a column of blank squares, so fall back to the
  // initial rather than to nothing.
  return collapsed ? (
    <span className="grid size-4 shrink-0 place-items-center text-xs font-semibold" aria-hidden>
      {item.label.charAt(0)}
    </span>
  ) : null;
}

function Leaf({
  item,
  collapsed,
  onNavigate,
}: Readonly<{ item: NavItem; collapsed: boolean; onNavigate?: () => void }>) {
  return (
    <NavLink
      to={item.to ?? '#'}
      end={item.to === '/'}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(ROW, isActive ? ROW_ACTIVE : ROW_IDLE, collapsed && 'justify-center px-0')
      }
    >
      <Glyph item={item} collapsed={collapsed} />
      {collapsed ? <span className="sr-only">{item.label}</span> : <span>{item.label}</span>}
    </NavLink>
  );
}

/** INLINE: an accordion under the section. */
function InlineSection({
  item,
  pathname,
  onNavigate,
}: Readonly<{ item: NavItem; pathname: string; onNavigate?: () => void }>) {
  const panelId = useId();
  // Open if you are already inside it — a collapsed section while its page is
  // showing is a sidebar that has lost your place.
  const [open, setOpen] = useState(() => isNavItemActive(item, pathname));

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className={cn(ROW, isNavItemActive(item, pathname) ? ROW_ACTIVE : ROW_IDLE)}
      >
        <Glyph item={item} collapsed={false} />
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronDown
          className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open ? (
        <ul id={panelId} className="mt-1 space-y-0.5 border-l border-border pl-3 ml-4">
          {(item.children ?? []).map((child) => (
            <li key={child.label}>
              <Leaf item={child} collapsed={false} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * PANEL: a click-opened panel beside the sidebar, one level, up to 80vh.
 *
 * On Radix Popover rather than an absolutely-positioned div, for one decisive
 * reason: the sidebar's nav scrolls, and `overflow-y-auto` creates a clipping
 * context that an absolute child cannot escape — the panel simply never
 * appeared. A portal escapes it. Radix also brings the behaviour this panel is
 * required to have and that is tedious to get right by hand: click not hover,
 * Esc and click-away, focus moved in and returned on close, and collision
 * handling so a section near the bottom flips instead of running off screen.
 */
function PanelSection({
  item,
  pathname,
  collapsed,
  onNavigate,
}: Readonly<{ item: NavItem; pathname: string; collapsed: boolean; onNavigate?: () => void }>) {
  const [open, setOpen] = useState(false);

  const children = item.children ?? [];
  // One level only. A child with children of its own becomes a labelled GROUP
  // inside this same panel — a second cascade is a menu you have to chase with
  // the pointer, and it is unusable on a trackpad.
  const groups = children.filter(isNavSection);
  const loose = children.filter((child) => !isNavSection(child));

  const close = () => {
    setOpen(false);
    onNavigate?.();
  };

  return (
    <li>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            title={collapsed ? item.label : undefined}
            className={cn(
              ROW,
              isNavItemActive(item, pathname) || open ? ROW_ACTIVE : ROW_IDLE,
              collapsed && 'justify-center px-0',
            )}
          >
            <Glyph item={item} collapsed={collapsed} />
            {collapsed ? (
              <span className="sr-only">{item.label}</span>
            ) : (
              <>
                <span className="flex-1 text-left">{item.label}</span>
                <ChevronRight className="size-4 shrink-0" aria-hidden />
              </>
            )}
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            side="right"
            align="start"
            // Flush and continuous with the section rather than floating near
            // it: aligned to the row it came from, one step off the sidebar.
            sideOffset={4}
            collisionPadding={8}
            className={cn(
              'z-[--z-popover] w-[--nav-panel-w] max-h-[--nav-panel-max-h] overflow-y-auto',
              'rounded-lg border border-border bg-surface p-2 shadow-lg',
            )}
          >
            <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {item.label}
            </p>

            {loose.length > 0 ? (
              <ul className="space-y-0.5">
                {loose.map((child) => (
                  <li key={child.label}>
                    <Leaf item={child} collapsed={false} onNavigate={close} />
                  </li>
                ))}
              </ul>
            ) : null}

            {groups.map((group) => (
              <div key={group.label} className="mt-2 first:mt-0">
                <p className="px-2 py-1 text-xs font-semibold text-foreground-secondary">
                  {group.label}
                </p>
                <ul className="space-y-0.5">
                  {(group.children ?? []).map((child) => (
                    <li key={child.label}>
                      <Leaf item={child} collapsed={false} onNavigate={close} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </li>
  );
}

/**
 * The desktop nav list. `collapsed` is the icon rail.
 *
 * In the rail every section becomes a PANEL regardless of its resolved layout:
 * an accordion has nowhere to expand into when the sidebar is 56px wide, and
 * expanding it would either overflow or silently truncate the labels.
 */
export function SidebarNav({
  items,
  pathname,
  collapsed,
  onNavigate,
}: Readonly<{
  items: readonly NavItem[];
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}>): ReactNode {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        if (!isNavSection(item)) {
          return (
            <li key={item.label}>
              <Leaf item={item} collapsed={collapsed} onNavigate={onNavigate} />
            </li>
          );
        }
        const layout = collapsed ? NAV_LAYOUT.PANEL : resolveNavLayout(item);
        return layout === NAV_LAYOUT.PANEL ? (
          <PanelSection
            key={item.label}
            item={item}
            pathname={pathname}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ) : (
          <InlineSection key={item.label} item={item} pathname={pathname} onNavigate={onNavigate} />
        );
      })}
    </ul>
  );
}

export { Leaf as NavLeaf, ROW as NAV_ROW, ROW_IDLE as NAV_ROW_IDLE };
