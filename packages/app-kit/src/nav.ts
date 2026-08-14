import { type LucideIcon } from 'lucide-react';

/**
 * How a section with children presents itself.
 *
 * The choice is not cosmetic. An accordion pushes everything below it down the
 * sidebar, which is fine for a handful of items and miserable for twenty — the
 * thing you were looking at leaves the screen. A panel keeps the sidebar still
 * and puts the children beside it, which is right for a long list and heavy
 * ceremony for three.
 *
 * AUTO picks between them by count, so a nav grows into the right shape without
 * anyone revisiting the decision. INLINE and PANEL exist for the cases where
 * the count is a bad predictor and a human knows better.
 */
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
  /**
   * Render only when `can(featureKey)` says so. Absent means always shown —
   * see `filterNavByPermission`, which is deliberately permissive when no
   * `can` is supplied at all.
   */
  featureKey?: string;
}

/** A section is an item with children. A leaf navigates; a section opens. */
export function isNavSection(item: NavItem): boolean {
  return (item.children?.length ?? 0) > 0;
}

/**
 * The layout a section actually uses — AUTO resolved against the child count.
 *
 * Returns INLINE for a leaf too. A leaf has nothing to expand, and giving the
 * caller a definite answer for every item beats making each one re-check
 * whether it is a section first.
 */
export function resolveNavLayout(item: NavItem): Exclude<NavLayout, 'AUTO'> {
  if (item.layout && item.layout !== NAV_LAYOUT.AUTO) return item.layout;
  const count = item.children?.length ?? 0;
  return count > NAV_INLINE_MAX_ITEMS ? NAV_LAYOUT.PANEL : NAV_LAYOUT.INLINE;
}

/**
 * Drop what this user may not see, at every depth.
 *
 * Two deliberate leniencies, and both are safe because **hiding a nav item is
 * not the security boundary** — every route behind one is enforced server-side.
 * This is about not offering a door that will not open.
 *
 *   - No `can` supplied → nothing is filtered. The student app has no
 *     permissions at all, and an app that never opted in should not silently
 *     lose its nav the day someone adds a `featureKey` somewhere.
 *   - No `featureKey` on an item → always visible.
 *
 * A section whose children all disappear disappears with them: a heading that
 * opens onto nothing is worse than no heading, because it reads as broken
 * rather than as absent. A section with its OWN `to` survives, because it is
 * still somewhere to go.
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

/**
 * Does this item, or anything under it, point at `pathname`?
 *
 * Used to mark a collapsed section as current: a sidebar that shows nothing
 * highlighted while you are plainly on one of its pages has lost you.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.to && (item.to === pathname || pathname.startsWith(`${item.to}/`))) return true;
  return (item.children ?? []).some((child) => isNavItemActive(child, pathname));
}
