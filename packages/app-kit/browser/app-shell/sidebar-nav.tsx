import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { ChevronRight } from 'lucide-react';
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

/**
 * A section, opened as a popover anchored to its own row.
 *
 * Both layouts open beside the sidebar rather than expanding into it. An
 * accordion is the obvious way to show children and the wrong one here: it
 * pushes every section below it down the sidebar, so the item you were aiming
 * at moves out from under the pointer at the moment you commit to it, and on a
 * short viewport the thing you opened scrolls out of view. A popover leaves the
 * sidebar exactly where it was.
 *
 * What `resolveNavLayout` still decides is the SHAPE, which is a real
 * difference: INLINE is sized to its contents, PANEL is a fixed width that
 * scrolls at 80vh and can carry labelled groups. A three-item popup has no
 * business being 17rem wide and 80vh tall, and a twenty-item one cannot be
 * anything else.
 *
 * Both therefore point RIGHT. The down-chevron is gone with the accordion it
 * described: nothing expands below any more, and an affordance that promises a
 * behaviour the component no longer has is worse than none.
 */
function SectionPopover({
  item,
  pathname,
  collapsed,
  wide,
  onNavigate,
}: Readonly<{
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  wide: boolean;
  onNavigate?: () => void;
}>) {
  const [open, setOpen] = useState(false);

  const children = item.children ?? [];
  // One level only. A child with children of its own becomes a labelled GROUP
  // inside this same popover — a second cascade is a menu you have to chase
  // with the pointer, and it is unusable on a trackpad.
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
            // Aligned to the row it came from and one step off the sidebar, so
            // it reads as continuous with the section rather than as a menu
            // that happens to be nearby.
            sideOffset={4}
            collisionPadding={8}
            className={cn(
              'z-[--z-popover] overflow-y-auto rounded-lg border border-border bg-surface p-2 shadow-lg',
              wide
                ? 'w-[--nav-panel-w] max-h-[--nav-panel-max-h]'
                : 'min-w-52 max-h-[--nav-panel-max-h]',
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
 * Every section opens as a popover; the resolved layout chooses whether it is
 * sized to its contents or a fixed scrolling panel. In the rail everything is
 * the wide shape, because a popover sized to a 56px trigger is not a size.
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
        const wide = collapsed || resolveNavLayout(item) === NAV_LAYOUT.PANEL;
        return (
          <SectionPopover
            key={item.label}
            item={item}
            pathname={pathname}
            collapsed={collapsed}
            wide={wide}
            onNavigate={onNavigate}
          />
        );
      })}
    </ul>
  );
}

export { Leaf as NavLeaf, ROW as NAV_ROW, ROW_IDLE as NAV_ROW_IDLE };
