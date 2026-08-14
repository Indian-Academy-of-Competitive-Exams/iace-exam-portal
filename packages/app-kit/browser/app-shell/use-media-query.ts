import { useCallback, useSyncExternalStore } from 'react';

/**
 * Tracks a media query, so the shell can pick a genuinely different structure
 * rather than rendering both and hiding one with CSS.
 *
 * It has to be JS because the desktop and mobile behaviours are not the same
 * markup styled differently: desktop opens a panel beside the sidebar, mobile
 * slides the drawer to a child list. Rendering both would put two focus traps
 * and two tab orders in the document at once, one of them invisible — which is
 * how a keyboard user ends up tabbing into a drawer that is not on screen.
 *
 * `useSyncExternalStore`, not `useState` + `useEffect`. matchMedia IS an
 * external store, and the effect version has to set state on mount to correct
 * its own initial guess — a cascading render that React's own lint rule
 * rejects, and a flash of the wrong structure besides.
 *
 * The server snapshot is `false`: the mobile structure is the one that works
 * everywhere, so an environment with no matchMedia gets the safe answer rather
 * than a sidebar it cannot lay out.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onStoreChange);
      return () => list.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** The one breakpoint the shell changes structure at — Tailwind's `lg`. */
export const DESKTOP_QUERY = '(min-width: 1024px)';
