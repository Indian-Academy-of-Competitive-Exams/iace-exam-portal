import { type QueryKey } from '@tanstack/react-query';
import { CSV_SEPARATOR, type Paginated } from '@iace/contracts';
import { type ListFilter, type ListState, type PaginationProps } from '@iace/ui';
import { useListQuery } from '../src';
import { useFilters } from './use-filters';

/** A `multi` filter reads as a set, every other kind as a string. Keyed off the spec's `kind`. */
type ListValues<TSpec extends readonly ListFilter[]> = {
  [K in TSpec[number] as K['key']]: K extends { kind: 'multi' } ? string[] : string;
};

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
  fetchPage: (params: TFilters & { page: number; pageSize: number }) => Promise<Paginated<TItem>>;
  enabled?: boolean;
}): ListState<TItem> & { total: number; pagination: PaginationProps } {
  const { queryKey, filters, toQuery, fetchPage, enabled } = options;
  const urlFilters = useFilters<string>();

  // The one place the wire format lives on this side: a set is CSV in the URL and on the query.
  const readValue = (filter: ListFilter): string | string[] => {
    const raw = urlFilters.get(filter.key);
    if (filter.kind !== 'multi') return raw;
    return raw ? raw.split(CSV_SEPARATOR).filter(Boolean) : [];
  };

  const values = Object.fromEntries(
    filters.map((filter) => [filter.key, readValue(filter)]),
  ) as ListValues<TSpec>;

  const list = useListQuery({ queryKey, filters: toQuery(values), fetchPage, enabled });

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
      urlFilters.set(Object.fromEntries(filters.map((filter) => [filter.key, undefined]))),
  };
}
