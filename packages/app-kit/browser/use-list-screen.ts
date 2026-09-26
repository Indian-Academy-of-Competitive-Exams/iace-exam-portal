import { type QueryKey } from '@tanstack/react-query';
import { type MatchMode, type Paginated } from '@iace/contracts';
import { type ListFilter, type ListState, type PaginationProps } from '@iace/ui';
import { useListQuery } from '../src';
import { useFilterSpec, type ListValues } from './use-filter-spec';
import { type FilterStore } from './use-local-filters';

/** One filtered, paginated list: the spec declares the URL keys, so nothing can disagree. */
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
  /** What the list is asked for minus the page: an export sends this, so the file matches the rows. */
  query: TFilters & { match?: MatchMode };
} {
  const { queryKey, filters, toQuery, fetchPage, enabled } = options;
  const spec = useFilterSpec(filters, options.store);

  const query = { ...toQuery(spec.values), match: spec.match };
  const list = useListQuery({
    queryKey,
    filters: query,
    fetchPage,
    enabled,
  });

  return {
    rows: list.items,
    total: list.total,
    isLoading: list.isLoading,
    hasLoaded: list.hasLoaded,
    isError: list.isError,
    retry: list.retry,
    pagination: list.pagination,
    values: spec.values,
    query,
    setFilter: spec.setFilter,
    clearFilters: spec.clearFilters,
    matchAny: spec.matchAny,
    setMatchAny: spec.setMatchAny,
  };
}
