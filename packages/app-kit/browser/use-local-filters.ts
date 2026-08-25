import { useCallback, useMemo, useState } from 'react';

/** `useFilters` without the URL, for a list nobody links to — a picker inside a dialog. */
export interface FilterStore<K extends string = string> {
  get: (key: K) => string;
  set: (changes: Partial<Record<K, string | undefined>>) => void;
  clear: (except?: readonly K[]) => void;
  activeCount: (keys: readonly K[]) => number;
}

export function useLocalFilters<K extends string>(): FilterStore<K> {
  const [values, setValues] = useState<Partial<Record<K, string>>>({});

  const get = useCallback((key: K) => values[key] ?? '', [values]);

  const set = useCallback((changes: Partial<Record<K, string | undefined>>) => {
    setValues((held) => {
      const next = { ...held };
      for (const key of Object.keys(changes) as K[]) {
        const value = changes[key];
        if (value === undefined || value === '') delete next[key];
        else next[key] = value;
      }
      return next;
    });
  }, []);

  const clear = useCallback((except: readonly K[] = []) => {
    setValues((held) =>
      Object.fromEntries(except.map((key) => [key, held[key]]).filter(([, value]) => value)),
    );
  }, []);

  const activeCount = useCallback(
    (keys: readonly K[]) => keys.filter((key) => (values[key] ?? '') !== '').length,
    [values],
  );

  return useMemo(() => ({ get, set, clear, activeCount }), [get, set, clear, activeCount]);
}
