import { type QueryKey } from '@tanstack/react-query';
import { CSV_SEPARATOR, MATCH_MODES, type MatchMode, type Paginated } from '@iace/contracts';
import {
  holdsASet,
  type ListFilter,
  type ListState,
  type PaginationProps,
  type SetKind,
} from '@iace/ui';
import { useListQuery } from '../src';
import { useFilters } from './use-filters';
import { type FilterStore } from './use-local-filters';

/** A set-valued filter reads as a set, every other kind as a string. Keyed off the spec's `kind`. */
type ListValues<TSpec extends readonly ListFilter[]> = {
  [K in TSpec[number] as K['key']]: K extends { kind: SetKind } ? string[] : string;
};

/** One filtered, paginated list: the spec declares the URL keys, so nothing can disagree. */
/** The match toggle lives in the URL beside the filters it governs, so a link carries it. */
const MATCH_KEY = 'match';

export function useListScreen<
  const TSpec extends readonly ListFilter[],
  TItem,
  TFilters extends object,
>(options: {
  /** Include everything the fetch depends on EXCEPT the filters, page and pageSize. */
  queryKey: QueryKey;
  filters: TSpec;
  /** The spec's values as the endpoint wants them — one filter may set several params. */
  toQuery: (values: ListValues<TSpec>) => TFilters;
  fetchPage: (
    params: TFilters & { page: number; pageSize: number; match?: MatchMode },
  ) => Promise<Paginated<TItem>>;
  enabled?: boolean;
  /** Where the values live. Defaults to the URL; a dialog passes `useLocalFilters()` instead. */
  store?: FilterStore;
}): Omit<ListState<TItem>, 'values'> & {
  /** Precise per key, so a screen reading a set back gets a set rather than the union. */
  values: ListValues<TSpec>;
  total: number;
  pagination: PaginationProps;
} {
  const { queryKey, filters, toQuery, fetchPage, enabled } = options;
  const url = useFilters<string>();
  const urlFilters = options.store ?? url;

  // The one place the wire format lives on this side: a set is CSV in the URL and on the query.
  const readValue = (filter: ListFilter): string | string[] => {
    const raw = urlFilters.get(filter.key);
    if (!holdsASet(filter)) return raw;
    return raw ? raw.split(CSV_SEPARATOR).filter(Boolean) : [];
  };

  const values = Object.fromEntries(
    filters.map((filter) => [filter.key, readValue(filter)]),
  ) as ListValues<TSpec>;

  // Absent unless it is ANY: every list narrowed before this existed, and still does by default.
  const matchAny = urlFilters.get(MATCH_KEY) === MATCH_MODES.ANY;
  const match = matchAny ? MATCH_MODES.ANY : undefined;

  const list = useListQuery({
    queryKey,
    filters: { ...toQuery(values), match },
    fetchPage,
    enabled,
  });

  return {
    rows: list.items,
    total: list.total,
    isLoading: list.isLoading,
    hasLoaded: list.hasLoaded,
    pagination: list.pagination,
    values,
    setFilter: (key, value) =>
      urlFilters.set({ [key]: typeof value === 'string' ? value : value.join(CSV_SEPARATOR) }),
    // Only this list's own keys: a tab, or another list on the page, is not a filter it may drop.
    clearFilters: () =>
      urlFilters.set({
        ...Object.fromEntries(filters.map((filter) => [filter.key, undefined])),
        [MATCH_KEY]: undefined,
      }),
    matchAny,
    setMatchAny: (next: boolean) =>
      urlFilters.set({ [MATCH_KEY]: next ? MATCH_MODES.ANY : undefined }),
  };
}
