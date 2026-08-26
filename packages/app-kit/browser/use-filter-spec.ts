import { CSV_SEPARATOR, MATCH_MODES, type MatchMode } from '@iace/contracts';
import { holdsASet, type ListFilter, type ListFilterValue, type SetKind } from '@iace/ui';
import { useFilters } from './use-filters';
import { type FilterStore } from './use-local-filters';

/** The half of a list that is its filters — shared by the paged one and the scrolling one. */

/** A set-valued filter reads as a set, every other kind as a string. Keyed off the spec's `kind`. */
export type ListValues<TSpec extends readonly ListFilter[]> = {
  [K in TSpec[number] as K['key']]: K extends { kind: SetKind } ? string[] : string;
};

/** The match toggle lives in the URL beside the filters it governs, so a link carries it. */
const MATCH_KEY = 'match';

export interface FilterSpecState<TSpec extends readonly ListFilter[]> {
  values: ListValues<TSpec>;
  /** What the query sends: absent unless it is ANY, so a list narrows as it always did. */
  match: MatchMode | undefined;
  matchAny: boolean;
  setFilter: (key: string, value: ListFilterValue) => void;
  clearFilters: () => void;
  setMatchAny: (matchAny: boolean) => void;
}

export function useFilterSpec<const TSpec extends readonly ListFilter[]>(
  filters: TSpec,
  store?: FilterStore,
): FilterSpecState<TSpec> {
  const url = useFilters<string>();
  const urlFilters = store ?? url;

  // The one place the wire format lives on this side: a set is CSV in the URL and on the query.
  const readValue = (filter: ListFilter): string | string[] => {
    const raw = urlFilters.get(filter.key);
    if (!holdsASet(filter)) return raw;
    return raw ? raw.split(CSV_SEPARATOR).filter(Boolean) : [];
  };

  const values = Object.fromEntries(
    filters.map((filter) => [filter.key, readValue(filter)]),
  ) as ListValues<TSpec>;

  const matchAny = urlFilters.get(MATCH_KEY) === MATCH_MODES.ANY;

  return {
    values,
    match: matchAny ? MATCH_MODES.ANY : undefined,
    matchAny,
    setFilter: (key, value) =>
      urlFilters.set({ [key]: typeof value === 'string' ? value : value.join(CSV_SEPARATOR) }),
    // Only this list's own keys: a tab, or another list on the page, is not a filter it may drop.
    clearFilters: () =>
      urlFilters.set({
        ...Object.fromEntries(filters.map((filter) => [filter.key, undefined])),
        [MATCH_KEY]: undefined,
      }),
    setMatchAny: (next: boolean) =>
      urlFilters.set({ [MATCH_KEY]: next ? MATCH_MODES.ANY : undefined }),
  };
}
