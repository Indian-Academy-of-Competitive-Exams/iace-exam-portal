import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@iace/ui';
import { activeNavPath, isNavSection, type NavItem } from '../../src';
import { NavLeaf } from './sidebar-nav';

/**
 * The mobile nav: drill-down, one level deep. A child with children of its own
 * renders as a labelled group rather than a second drill.
 */
export function DrawerNav({
  items,
  pathname,
  onNavigate,
}: Readonly<{ items: readonly NavItem[]; pathname: string; onNavigate: () => void }>) {
  const [section, setSection] = useState<NavItem | null>(null);
  const activePath = activeNavPath(items, pathname);

  if (section) {
    const children = section.children ?? [];
    const groups = children.filter(isNavSection);
    const loose = children.filter((child) => !isNavSection(child));

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
          <div key={group.label} className="mt-3 first:mt-0">
            <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </p>
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
      </div>
    );
  }

  return (
    <ul className="space-y-0.5">
      {items.map((item) =>
        isNavSection(item) ? (
          <li key={item.label}>
            <button
              type="button"
              onClick={() => setSection(item)}
              className={cn(
                'flex h-[--nav-item-h-touch] w-full items-center gap-3 rounded-md px-3',
                'text-sm font-medium text-muted-foreground',
                'hover:bg-muted hover:text-foreground',
                'focus-visible:shadow-focus focus-visible:outline-none',
              )}
            >
              {item.icon ? <item.icon className="size-4 shrink-0" aria-hidden /> : null}
              <span className="flex-1 text-left">{item.label}</span>
              <ChevronRight className="size-4 shrink-0" aria-hidden />
            </button>
          </li>
        ) : (
          <li key={item.label}>
            <NavLeaf
              item={item}
              collapsed={false}
              activePath={activePath}
              onNavigate={onNavigate}
            />
          </li>
        ),
      )}
    </ul>
  );
}
