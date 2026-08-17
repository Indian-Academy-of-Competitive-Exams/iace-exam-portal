import { useCallback, useSyncExternalStore } from 'react';

/**
 * Tracks a media query so the shell can pick a different structure, not hide one with CSS.
 * `useSyncExternalStore` — matchMedia is an external store. Server snapshot is the mobile one.
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
