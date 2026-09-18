/**
 * The web's filter spec on a phone. One array declares the keys, and from it come the controls,
 * the active count and what Clear drops — so those three cannot disagree. Same kinds and the same
 * `primary` rule as `ListFilter` in packages/ui; what differs is where the folded ones are drawn.
 */
import { useCallback, useMemo, useState } from 'react';

export type FilterValue = string | readonly string[];

export interface FilterOption {
  value: string;
  label: string;
}

interface FilterBase {
  key: string;
  label: string;
  /** Inline on the screen. Everything else folds into the sheet, which is all a phone has room for. */
  primary?: boolean;
}

export type Filter =
  | (FilterBase & { kind: 'search'; placeholder?: string })
  /** `items` carries its own "Any …" row, so the control is never also clearable. */
  | (FilterBase & { kind: 'choice'; items: readonly FilterOption[] })
  /** Several at once. No "Any …" row: choosing nothing already means every one of them. */
  | (FilterBase & { kind: 'multi'; items: readonly FilterOption[] });

export type FilterValues = Readonly<Record<string, FilterValue>>;

const isSet = (value: FilterValue | undefined): boolean =>
  Array.isArray(value) ? value.length > 0 : (value ?? '') !== '';

/** How many of a spec are set. Read by the bar for its badge and by the list for its empty state. */
export function activeFilterCount(values: FilterValues, filters: readonly Filter[]): number {
  return filters.filter((filter) => isSet(values[filter.key])).length;
}

export const asText = (value: FilterValue | undefined): string =>
  typeof value === 'string' ? value : '';

export const asSet = (value: FilterValue | undefined): readonly string[] =>
  Array.isArray(value) ? value : [];

export interface FilterState {
  values: FilterValues;
  setFilter: (key: string, value: FilterValue) => void;
  clearFilters: () => void;
  /** What is set right now — the count the bar badges and the empty state reads. */
  activeCount: number;
}

/** The web keeps this in the URL; a phone has none, so the screen holds it. */
export function useFilterState(filters: readonly Filter[]): FilterState {
  const [values, setValues] = useState<FilterValues>({});

  const setFilter = useCallback((key: string, value: FilterValue) => {
    setValues((held) => ({ ...held, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => setValues({}), []);

  const activeCount = useMemo(() => activeFilterCount(values, filters), [values, filters]);

  return { values, setFilter, clearFilters, activeCount };
}
