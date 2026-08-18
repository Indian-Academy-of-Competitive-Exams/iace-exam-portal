import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { ChevronRight } from 'lucide-react';
import { cn } from '@iace/ui';
import {
  NAV_LAYOUT,
  activeNavPath,
  isNavItemActive,
  isNavSection,
  resolveNavLayout,
  type NavItem,
} from '../../src';

/** One row in the sidebar. The chevron points right: a panel opens beside, never below. */
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
  activePath,
  onNavigate,
}: Readonly<{
  item: NavItem;
  collapsed: boolean;
  activePath?: string;
  onNavigate?: () => void;
}>) {
  // Plain Link, not NavLink: NavLink decides `isActive` by prefix and would both
  // stamp its own aria-current and append its own class token over the top.
  const isActive = item.to !== undefined && item.to === activePath;

  return (
    <Link
      to={item.to ?? '#'}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      aria-current={isActive ? 'page' : undefined}
      className={cn(ROW, isActive ? ROW_ACTIVE : ROW_IDLE, collapsed && 'justify-center px-0')}
    >
      <Glyph item={item} collapsed={collapsed} />
      {collapsed ? <span className="sr-only">{item.label}</span> : <span>{item.label}</span>}
    </Link>
  );
}

/**
 * A section, opened as a popover beside its row so the sidebar never moves.
 * `resolveNavLayout` picks the shape: INLINE sized to contents, PANEL fixed and scrolling.
 */
function SectionPopover({
  item,
  activePath,
  collapsed,
  wide,
  onNavigate,
}: Readonly<{
  item: NavItem;
  activePath?: string;
  collapsed: boolean;
  wide: boolean;
  onNavigate?: () => void;
}>) {
  const [open, setOpen] = useState(false);

  const children = item.children ?? [];
  // One level only: a child with children becomes a labelled group in this popover.
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
              isNavItemActive(item, activePath) || open ? ROW_ACTIVE : ROW_IDLE,
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
            // Aligned to its row and one step off the sidebar.
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
                    <Leaf
                      item={child}
                      collapsed={false}
                      activePath={activePath}
                      onNavigate={close}
                    />
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
                      <Leaf
                        item={child}
                        collapsed={false}
                        activePath={activePath}
                        onNavigate={close}
                      />
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

/** The desktop nav list. `collapsed` is the icon rail, where every popover is the wide shape. */
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
  const activePath = activeNavPath(items, pathname);

  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        if (!isNavSection(item)) {
          return (
            <li key={item.label}>
              <Leaf
                item={item}
                collapsed={collapsed}
                activePath={activePath}
                onNavigate={onNavigate}
              />
            </li>
          );
        }
        const wide = collapsed || resolveNavLayout(item) === NAV_LAYOUT.PANEL;
        return (
          <SectionPopover
            key={item.label}
            item={item}
            activePath={activePath}
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
