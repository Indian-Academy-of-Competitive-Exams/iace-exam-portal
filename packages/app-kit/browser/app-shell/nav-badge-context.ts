import * as React from 'react';

/** Counts a nav row carries, keyed by its route — a number, so `nav.ts` stays DOM-free. */
export type NavBadges = Readonly<Record<string, number>>;

export const NavBadgeContext = React.createContext<NavBadges>({});

/** Zero is no badge: a row announcing "0 unread" is a row saying nothing. */
export function useNavBadge(to: string | undefined): number {
  const badges = React.useContext(NavBadgeContext);
  return to === undefined ? 0 : (badges[to] ?? 0);
}
