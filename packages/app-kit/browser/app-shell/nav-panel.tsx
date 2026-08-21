import { useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@iace/ui';
import {
  NAV_LAYOUT,
  activeNavPath,
  isNavItemActive,
  isNavSection,
  resolveNavLayout,
  type NavItem,
} from '../../src';
import { NAV_ROW, NAV_ROW_ACTIVE, NAV_ROW_IDLE, NavLeaf } from './sidebar-nav';

/** The children of one section, as a flat list plus any labelled groups under it. */
function SectionChildren({
  item,
  activePath,
  onNavigate,
}: Readonly<{ item: NavItem; activePath?: string; onNavigate: () => void }>) {
  const children = item.children ?? [];
  // One level only: a child with children of its own becomes a labelled group here.
  const groups = children.filter(isNavSection);
  const loose = children.filter((child) => !isNavSection(child));

  return (
    <>
      {loose.length > 0 ? (
        <ul className="space-y-0.5">
          {loose.map((child) => (
            <li key={child.label}>
              <NavLeaf
                item={child}
                collapsed={false}
                activePath={activePath}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {groups.map((group) => (
        <div key={group.label} className="mt-2 first:mt-0">
          <p className="px-2 py-1 text-xs font-semibold text-foreground-secondary">{group.label}</p>
          <ul className="space-y-0.5">
            {(group.children ?? []).map((child) => (
              <li key={child.label}>
                <NavLeaf
                  item={child}
                  collapsed={false}
                  activePath={activePath}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/** A section too tall to sit inline. Opens beside the panel rather than growing it. */
function SectionPopover({
  item,
  activePath,
  onNavigate,
}: Readonly<{ item: NavItem; activePath?: string; onNavigate: () => void }>) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            NAV_ROW,
            isNavItemActive(item, activePath) || open ? NAV_ROW_ACTIVE : NAV_ROW_IDLE,
          )}
        >
          <SectionGlyph item={item} />
          <span className="flex-1 text-left">{item.label}</span>
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className="z-[--z-popover] w-[--nav-panel-w] max-h-[--nav-panel-max-h] overflow-y-auto rounded-lg border border-border bg-surface p-2 shadow-lg"
        >
          <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {item.label}
          </p>
          <SectionChildren
            item={item}
            activePath={activePath}
            onNavigate={() => {
              setOpen(false);
              onNavigate();
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SectionGlyph({ item }: Readonly<{ item: NavItem }>) {
  const Icon = item.icon;
  return Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null;
}

/** A section that drops its children into the panel, under its own row. */
function SectionAccordion({
  item,
  activePath,
  open,
  onToggle,
  onNavigate,
}: Readonly<{
  item: NavItem;
  activePath?: string;
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}>) {
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(NAV_ROW, isNavItemActive(item, activePath) ? NAV_ROW_ACTIVE : NAV_ROW_IDLE)}
      >
        <SectionGlyph item={item} />
        <span className="flex-1 text-left">{item.label}</span>
        {open ? (
          <ChevronDown className="size-4 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        )}
      </button>

      {/* Indented against the rule, so a child reads as belonging to the row above it. */}
      {open ? (
        <div className="ml-4 border-l border-border pl-2 pt-0.5">
          <SectionChildren item={item} activePath={activePath} onNavigate={onNavigate} />
        </div>
      ) : null}
    </>
  );
}

/** One level at a time, in the panel itself: over a sheet, a popover is a modal over a modal. */
function DrilldownNav({
  items,
  activePath,
  onNavigate,
}: Readonly<{ items: readonly NavItem[]; activePath?: string; onNavigate: () => void }>) {
  const [section, setSection] = useState<NavItem | null>(null);

  if (section) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setSection(null)}
          className={cn(
            'mb-2 flex h-[--nav-item-h-touch] w-full items-center gap-2 rounded-md px-3',
            'text-sm font-semibold text-foreground',
            'hover:bg-muted focus-visible:shadow-focus focus-visible:outline-none',
          )}
        >
          <ChevronLeft className="size-4 shrink-0" aria-hidden />
          {section.label}
        </button>

        <SectionChildren item={section} activePath={activePath} onNavigate={onNavigate} />
      </div>
    );
  }

  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.label}>
          {isNavSection(item) ? (
            <button
              type="button"
              onClick={() => setSection(item)}
              className={cn(
                'flex h-[--nav-item-h-touch] w-full items-center gap-3 rounded-md px-3 text-sm font-medium',
                isNavItemActive(item, activePath) ? NAV_ROW_ACTIVE : NAV_ROW_IDLE,
                'focus-visible:shadow-focus focus-visible:outline-none',
              )}
            >
              <SectionGlyph item={item} />
              <span className="flex-1 text-left">{item.label}</span>
              <ChevronRight className="size-4 shrink-0" aria-hidden />
            </button>
          ) : (
            <NavLeaf
              item={item}
              collapsed={false}
              activePath={activePath}
              onNavigate={onNavigate}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/** The overlay nav: sections drop open in place, one at a time; an oversized one opens beside. */
export function NavPanel({
  items,
  pathname,
  drilldown = false,
  onNavigate,
}: Readonly<{
  items: readonly NavItem[];
  pathname: string;
  /** Touch: one level at a time in the panel, never a popover. */
  drilldown?: boolean;
  onNavigate: () => void;
}>): ReactNode {
  const activePath = activeNavPath(items, pathname);
  // Seeded from the route, so the panel opens showing where you already are.
  const [openLabel, setOpenLabel] = useState<string | undefined>(
    () => items.find((item) => isNavSection(item) && isNavItemActive(item, activePath))?.label,
  );

  if (drilldown) {
    return <DrilldownNav items={items} activePath={activePath} onNavigate={onNavigate} />;
  }

  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        if (!isNavSection(item)) {
          return (
            <li key={item.label}>
              <NavLeaf
                item={item}
                collapsed={false}
                activePath={activePath}
                onNavigate={onNavigate}
              />
            </li>
          );
        }

        if (resolveNavLayout(item) === NAV_LAYOUT.PANEL) {
          return (
            <li key={item.label}>
              <SectionPopover item={item} activePath={activePath} onNavigate={onNavigate} />
            </li>
          );
        }

        return (
          <li key={item.label}>
            <SectionAccordion
              item={item}
              activePath={activePath}
              open={openLabel === item.label}
              onToggle={() => setOpenLabel((was) => (was === item.label ? undefined : item.label))}
              onNavigate={onNavigate}
            />
          </li>
        );
      })}
    </ul>
  );
}
