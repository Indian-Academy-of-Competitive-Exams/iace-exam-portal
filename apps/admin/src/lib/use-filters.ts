import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Filters in the URL, so a link into a screen and its own controls are the same state.
 * The PAGE is not here: every filter change has to reset it, and that belongs with the page state.
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
      for (const key of Object.keys(changes) as K[]) {
        const value = changes[key];
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }
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
