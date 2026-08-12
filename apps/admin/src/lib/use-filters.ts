import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Filters kept in the URL rather than in component state.
 *
 * This is what makes a link into a screen and the screen's own controls the
 * same thing. Held in `useState`, a filter set by a link is simply ignored —
 * the Branches page linked to `/groups?branchId=…` for a week and the Groups
 * page never read it, so the link looked broken while every control worked.
 *
 * It also means a filtered roster can be sent to someone, and the back button
 * returns to what you were looking at instead of an unfiltered list.
 */
export function useFilters<K extends string>(): {
  get: (key: K) => string;
  set: (changes: Partial<Record<K, string | undefined>>) => void;
  clear: (except?: readonly K[]) => void;
  activeCount: (keys: readonly K[]) => number;
} {
  const [params, setParams] = useSearchParams();

  const get = useCallback((key: K) => params.get(key) ?? '', [params]);

  const set = useCallback(
    (changes: Partial<Record<K, string | undefined>>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      // Any filter change invalidates the page number: page 4 of the old
      // result set is usually past the end of the new one, and an empty table
      // reads as "there are none" rather than "you are too far in".
      next.delete('page');
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const clear = useCallback(
    (except: readonly K[] = []) => {
      const next = new URLSearchParams();
      for (const key of except) {
        const value = params.get(key);
        if (value) next.set(key, value);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const activeCount = useCallback(
    (keys: readonly K[]) => keys.filter((key) => (params.get(key) ?? '') !== '').length,
    [params],
  );

  return useMemo(() => ({ get, set, clear, activeCount }), [get, set, clear, activeCount]);
}
