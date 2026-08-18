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
  featureKey?: string;
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

/**
 * Drop what this user may not see, at every depth. No `can` or no `featureKey` means
 * visible — hiding nav is not the security boundary. An emptied section goes with its children.
 */
export function filterNavByPermission(
  items: readonly NavItem[],
  can?: (featureKey: string) => boolean,
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

/** Does this item, or anything under it, own `activePath`? Marks a collapsed section current. */
export function isNavItemActive(item: NavItem, activePath: string | undefined): boolean {
  if (activePath !== undefined && item.to === activePath) return true;
  return (item.children ?? []).some((child) => isNavItemActive(child, activePath));
}
