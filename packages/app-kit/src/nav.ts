import { type FeatureKey } from '@iace/contracts';
import { type LucideIcon } from 'lucide-react';

/** How a section with children presents itself. AUTO picks by child count. */
export const NAV_LAYOUT = {
  AUTO: 'AUTO',
  INLINE: 'INLINE',
  PANEL: 'PANEL',
} as const;
export type NavLayout = (typeof NAV_LAYOUT)[keyof typeof NAV_LAYOUT];

/** AUTO: at most this many children stay inline; more open a panel. */
export const NAV_INLINE_MAX_ITEMS = 6;

export interface NavItem {
  label: string;
  icon?: LucideIcon;
  /** A leaf route. A section (one with `children`) does not navigate. */
  to?: string;
  children?: NavItem[];
  /** Defaults to AUTO. Override to force INLINE or PANEL. */
  layout?: NavLayout;
  /** Render only when `can(featureKey)` says so. Absent means always shown. */
  featureKey?: FeatureKey;
}

/** A section is an item with children. A leaf navigates; a section opens. */
export function isNavSection(item: NavItem): boolean {
  return (item.children?.length ?? 0) > 0;
}

/** AUTO resolved against the child count. A leaf answers INLINE rather than nothing. */
export function resolveNavLayout(item: NavItem): Exclude<NavLayout, 'AUTO'> {
  if (item.layout && item.layout !== NAV_LAYOUT.AUTO) return item.layout;
  const count = item.children?.length ?? 0;
  return count > NAV_INLINE_MAX_ITEMS ? NAV_LAYOUT.PANEL : NAV_LAYOUT.INLINE;
}

/** Drop what a viewer may not see, at every depth. An emptied section goes with its children. */
export function filterNavBy<T extends NavItem & { children?: T[] }>(
  items: readonly T[],
  hidden: (item: T) => boolean,
): T[] {
  return items.reduce<T[]>((kept, item) => {
    if (hidden(item)) return kept;
    const children = item.children ? filterNavBy(item.children, hidden) : undefined;
    if (children?.length === 0 && !item.to) return kept;
    kept.push(children ? { ...item, children } : item);
    return kept;
  }, []);
}

/**
 * Drop what this user may not see, at every depth. No `can` or no `featureKey` means
 * visible — hiding nav is not the security boundary. An emptied section goes with its children.
 */
export function filterNavByPermission(
  items: readonly NavItem[],
  can?: (featureKey: FeatureKey) => boolean,
): NavItem[] {
  return items.reduce<NavItem[]>((kept, item) => {
    if (item.featureKey && can && !can(item.featureKey)) return kept;

    if (!isNavSection(item)) {
      kept.push(item);
      return kept;
    }

    const children = filterNavByPermission(item.children ?? [], can);
    if (children.length === 0 && !item.to) return kept;
    kept.push({ ...item, children });
    return kept;
  }, []);
}

function everyNavPath(items: readonly NavItem[]): string[] {
  return items.flatMap((item) => [
    ...(item.to ? [item.to] : []),
    ...everyNavPath(item.children ?? []),
  ]);
}

/**
 * The ONE route the nav should mark current: the longest `to` the path matches, so a route that
 * extends a sibling's (`/students/import` under `/students`) highlights only the sibling it is.
 */
export function activeNavPath(items: readonly NavItem[], pathname: string): string | undefined {
  return everyNavPath(items)
    .filter((to) => to === pathname || pathname.startsWith(`${to}/`))
    .sort((a, b) => b.length - a.length)[0];
}

/** One step on the way to the current page. Only the last one is where you already are. */
export interface Crumb {
  label: string;
  /** Absent only when nothing under this step can be navigated to. */
  to?: string;
}

/** A section is not a screen, so its crumb goes to the first screen it holds. */
function firstScreenIn(item: NavItem): string | undefined {
  if (item.to !== undefined) return item.to;
  for (const child of item.children ?? []) {
    const found = firstScreenIn(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The trail to `pathname`, always with one crumb you can follow back. A one-item trail is none. */
export function navTrail(items: readonly NavItem[], pathname: string): Crumb[] {
  const active = activeNavPath(items, pathname);
  if (active === undefined) return [];

  const walk = (list: readonly NavItem[], above: Crumb[]): Crumb[] | undefined => {
    for (const item of list) {
      const to = item.to ?? firstScreenIn(item);
      const here = [...above, { label: item.label, ...(to !== undefined ? { to } : {}) }];
      if (item.to === active) return here;

      const deeper = walk(item.children ?? [], here);
      if (deeper) return deeper;
    }
    return undefined;
  };

  const trail = walk(items, []) ?? [];
  if (trail.length < 2) return [];

  // An ancestor pointing at the current page is a link that goes nowhere, and a back arrow to here.
  const last = trail.at(-1);
  return trail.map((crumb, index) =>
    index < trail.length - 1 && crumb.to === last?.to ? { label: crumb.label } : crumb,
  );
}

/** Does this item, or anything under it, own `activePath`? Marks a collapsed section current. */
export function isNavItemActive(item: NavItem, activePath: string | undefined): boolean {
  if (activePath !== undefined && item.to === activePath) return true;
  return (item.children ?? []).some((child) => isNavItemActive(child, activePath));
}
