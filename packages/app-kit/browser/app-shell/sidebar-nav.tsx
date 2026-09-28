import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { NavBadge, useNavBadge } from './nav-badges';
import * as Popover from '@radix-ui/react-popover';
import { cn, Tooltip, TooltipContent, TooltipTrigger } from '@iace/ui';
import { activeNavPath, isNavItemActive, isNavSection, type NavItem } from '../../src';

/** One row in the sidebar. The chevron points right: a panel opens beside, never below. */
const ROW = [
  'flex w-full items-center gap-3 rounded-md px-3 text-sm font-medium',
  'h-[--nav-item-h] transition-colors',
  'focus-visible:shadow-focus focus-visible:outline-none',
].join(' ');

const ROW_IDLE = 'text-muted-foreground hover:bg-muted hover:text-foreground';

/** Collapsed, the row IS the glyph: square and round, so the hover is a disc around it. */
const ROW_RAIL = 'mx-auto w-[--nav-item-h] justify-center rounded-full px-0';
const ROW_ACTIVE = 'bg-primary-subtle text-primary-ink';

/** In the rail a row is a bare glyph, so the label has to arrive on hover and on focus. */
function RailTooltip({
  label,
  collapsed,
  children,
}: Readonly<{ label: string; collapsed: boolean; children: ReactNode }>) {
  if (!collapsed) return <>{children}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function Glyph({ item, collapsed }: Readonly<{ item: NavItem; collapsed: boolean }>) {
  const Icon = item.icon;
  if (Icon) return <Icon className="size-4 shrink-0" aria-hidden />;
  // A rail with no icon would be a column of blank squares, so fall back to the initial.
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
  // Plain Link, not NavLink: NavLink decides `isActive` by prefix and would double-stamp aria-current and class.
  const isActive = item.to !== undefined && item.to === activePath;
  const count = useNavBadge(item.to);
  const label = count > 0 ? `${item.label}, ${count} unread` : item.label;

  return (
    <RailTooltip label={label} collapsed={collapsed}>
      <Link
        to={item.to ?? '#'}
        onClick={onNavigate}
        aria-current={isActive ? 'page' : undefined}
        className={cn(ROW, isActive ? ROW_ACTIVE : ROW_IDLE, collapsed && ROW_RAIL)}
      >
        <span className="relative flex shrink-0 items-center">
          <Glyph item={item} collapsed={collapsed} />
          {collapsed ? <NavBadge count={count} collapsed /> : null}
        </span>
        {collapsed ? <span className="sr-only">{label}</span> : <span>{item.label}</span>}
        {collapsed ? null : <NavBadge count={count} collapsed={false} />}
      </Link>
    </RailTooltip>
  );
}

/** A section opens as the wide popover beside its rail row, so the sidebar never moves. */
function SectionPopover({ item, activePath }: Readonly<{ item: NavItem; activePath?: string }>) {
  const [open, setOpen] = useState(false);

  const children = item.children ?? [];
  // One level only: a child with children becomes a labelled group in this popover.
  const groups = children.filter(isNavSection);
  const loose = children.filter((child) => !isNavSection(child));

  const close = () => setOpen(false);

  return (
    <li>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <RailTooltip label={item.label} collapsed>
          <Popover.Trigger asChild>
            <button
              type="button"
              className={cn(
                ROW,
                isNavItemActive(item, activePath) || open ? ROW_ACTIVE : ROW_IDLE,
                ROW_RAIL,
              )}
            >
              <Glyph item={item} collapsed />
              <span className="sr-only">{item.label}</span>
            </button>
          </Popover.Trigger>
        </RailTooltip>

        <Popover.Portal>
          <Popover.Content
            side="right"
            align="start"
            // Aligned to its row and one step off the sidebar.
            sideOffset={4}
            collisionPadding={8}
            className="z-[--z-popover] flex max-h-[--nav-panel-max-h] w-[--nav-panel-w] flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-surface p-2 shadow-lg"
          >
            <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {item.label}
            </p>

            {loose.length > 0 ? (
              <ul className="flex flex-col gap-0.5">
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
              <div key={group.label} className="flex flex-col gap-0.5">
                <p className="px-2 py-1 text-xs font-semibold text-foreground-secondary">
                  {group.label}
                </p>
                <ul className="flex flex-col gap-0.5">
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

/** The desktop icon rail: a row is its glyph, and a section opens beside it. */
export function SidebarNav({
  items,
  pathname,
}: Readonly<{ items: readonly NavItem[]; pathname: string }>): ReactNode {
  const activePath = activeNavPath(items, pathname);

  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) =>
        isNavSection(item) ? (
          <SectionPopover key={item.label} item={item} activePath={activePath} />
        ) : (
          <li key={item.label}>
            <Leaf item={item} collapsed activePath={activePath} />
          </li>
        ),
      )}
    </ul>
  );
}

export { Leaf as NavLeaf, ROW as NAV_ROW, ROW_IDLE as NAV_ROW_IDLE, ROW_ACTIVE as NAV_ROW_ACTIVE };
