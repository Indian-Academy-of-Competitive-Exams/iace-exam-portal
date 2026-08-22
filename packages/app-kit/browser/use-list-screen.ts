import { type QueryKey } from '@tanstack/react-query';
import { type Paginated } from '@iace/contracts';
import { type ListFilter, type ListState, type PaginationProps } from '@iace/ui';
import { useListQuery } from '../src';
import { useFilters } from './use-filters';

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
  toQuery: (values: Record<TSpec[number]['key'], string>) => TFilters;
  fetchPage: (params: TFilters & { page: number; pageSize: number }) => Promise<Paginated<TItem>>;
  enabled?: boolean;
}): ListState<TItem> & { total: number; pagination: PaginationProps } {
  const { queryKey, filters, toQuery, fetchPage, enabled } = options;
  const urlFilters = useFilters<string>();

  const values = Object.fromEntries(
    filters.map((filter) => [filter.key, urlFilters.get(filter.key)]),
  ) as Record<TSpec[number]['key'], string>;

  const list = useListQuery({ queryKey, filters: toQuery(values), fetchPage, enabled });

  return {
    rows: list.items,
    total: list.total,
    isLoading: list.isLoading,
    hasLoaded: list.hasLoaded,
    pagination: list.pagination,
    values,
    setFilter: (key, value) => urlFilters.set({ [key]: value }),
    // Only this list's own keys: a tab, or another list on the page, is not a filter it may drop.
    clearFilters: () =>
      urlFilters.set(Object.fromEntries(filters.map((filter) => [filter.key, undefined]))),
  };
}
