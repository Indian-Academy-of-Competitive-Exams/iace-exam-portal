import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@iace/ui';
import { isNavSection, type NavItem } from '../../src';
import { NavLeaf } from './sidebar-nav';

/**
 * The mobile nav: drill-down, never a side panel.
 *
 * A panel beside a drawer has nowhere to go on a 390px screen, and an
 * accordion buries the thing you were reaching for under the section above it.
 * Drilling gives every level the full width and one obvious way back, which is
 * the pattern every phone OS already taught the reader.
 *
 * Depth is one level, matching the desktop panel: a child with children of its
 * own renders as a labelled group in the same list rather than a second drill.
 * Two identical-looking back arrows that mean different things is how people
 * get lost.
 */
export function DrawerNav({
  items,
  onNavigate,
}: Readonly<{ items: readonly NavItem[]; onNavigate: () => void }>) {
  const [section, setSection] = useState<NavItem | null>(null);

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
                <NavLeaf item={child} collapsed={false} onNavigate={onNavigate} />
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
                  <NavLeaf item={child} collapsed={false} onNavigate={onNavigate} />
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
            <NavLeaf item={item} collapsed={false} onNavigate={onNavigate} />
          </li>
        ),
      )}
    </ul>
  );
}
