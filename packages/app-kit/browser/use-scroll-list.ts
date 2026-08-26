import { type QueryKey } from '@tanstack/react-query';
import { type MatchMode, type Paginated } from '@iace/contracts';
import { type ListFilter, type ListState } from '@iace/ui';
import { filterKey, useInfinitePages } from '../src';
import { useFilterSpec, type ListValues } from './use-filter-spec';
import { type FilterStore } from './use-local-filters';

/** `useListScreen`'s filter spec over infinite pages: a picker loses its place when a page flips. */
export function useScrollList<
  const TSpec extends readonly ListFilter[],
  TItem,
  TFilters extends object,
>(options: {
  /** Include everything the fetch depends on EXCEPT the filters and the page. */
  queryKey: QueryKey;
  filters: TSpec;
  toQuery: (values: ListValues<TSpec>) => TFilters;
  fetchPage: (params: TFilters & { page: number; match?: MatchMode }) => Promise<Paginated<TItem>>;
  enabled?: boolean;
  store?: FilterStore;
}): Omit<ListState<TItem>, 'values'> & { values: ListValues<TSpec>; total: number } {
  const { queryKey, filters, toQuery, fetchPage, enabled } = options;
  const spec = useFilterSpec(filters, options.store);
  const query = { ...toQuery(spec.values), match: spec.match };

  const pages = useInfinitePages({
    // The filters are part of the key, so changing one starts the pool again rather than appending.
    queryKey: [...queryKey, filterKey(query)],
    fetchPage: (page) => fetchPage({ ...query, page }),
    enabled,
  });

  return {
    rows: pages.items,
    total: pages.total,
    isLoading: pages.isLoading,
    hasLoaded: !pages.isLoading,
    scroll: {
      hasMore: pages.hasMore,
      onLoadMore: pages.loadMore,
      isLoadingMore: pages.isLoadingMore,
    },
    values: spec.values,
    setFilter: spec.setFilter,
    clearFilters: spec.clearFilters,
    matchAny: spec.matchAny,
    setMatchAny: spec.setMatchAny,
  };
}
