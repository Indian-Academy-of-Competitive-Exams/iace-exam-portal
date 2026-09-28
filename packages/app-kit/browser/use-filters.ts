import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type FilterStore } from './use-local-filters';

/** Filters live in the URL so a link into a screen and its own controls share state; PAGE is excluded since a filter change must reset it, which belongs with page state. */
export function useFilters<K extends string>(): FilterStore<K> {
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
