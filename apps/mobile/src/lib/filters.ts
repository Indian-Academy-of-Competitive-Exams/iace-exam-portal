/**
 * The phone's half of the filter spec: the state a screen holds, and what is set. WHICH filters a
 * screen has, and what its choices are called, come from `@iace/app-kit` — one definition per page,
 * shared with the web, because the two had already drifted on keys and labels.
 */
import { useCallback, useMemo, useState } from 'react';
import { asSet, asText, type FilterSpec, type FilterValue } from '@iace/app-kit';

export type { FilterSpec, FilterValue } from '@iace/app-kit';
export { ANY_CHOICE, asSet, asText } from '@iace/app-kit';

export type FilterValues = Readonly<Record<string, FilterValue>>;

const isSet = (value: FilterValue | undefined): boolean =>
  Array.isArray(value) ? value.length > 0 : (value ?? '') !== '';

/** How many of a spec are set. Read by the bar for its badge and by the list for its empty state. */
export function activeFilterCount(values: FilterValues, filters: readonly FilterSpec[]): number {
  return filters.filter((filter) => isSet(values[filter.key])).length;
}

/** What is set, in the words the reader chose them by — the line under a screen's title. */
export function summaryOf(filters: readonly FilterSpec[], values: FilterValues): string[] {
  return filters.flatMap((filter) => {
    if (filter.kind === 'search') return [];
    const held = filter.kind === 'multi' ? asSet(values[filter.key]) : [asText(values[filter.key])];
    return held
      .filter((one) => one !== '')
      .map((one) => filter.items?.find((item) => item.value === one)?.label ?? one);
  });
}

export interface FilterState {
  values: FilterValues;
  setFilter: (key: string, value: FilterValue) => void;
  clearFilters: () => void;
  /** What is set right now — the count the bar badges and the empty state reads. */
  activeCount: number;
}

/** The web keeps this in the URL; a phone has none, so the screen holds it. */
export function useFilterState(filters: readonly FilterSpec[]): FilterState {
  const [values, setValues] = useState<FilterValues>({});

  const setFilter = useCallback((key: string, value: FilterValue) => {
    setValues((held) => ({ ...held, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => setValues({}), []);

  const activeCount = useMemo(() => activeFilterCount(values, filters), [values, filters]);

  return { values, setFilter, clearFilters, activeCount };
}
