import { useCallback, useState } from 'react';
import { keepPreviousData, useQuery, type QueryKey } from '@tanstack/react-query';
import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_OPTIONS,
  isPageSizeOption,
  type Paginated,
  type PageSizeOption,
} from '@iace/contracts';

/**
 * A stable identity for one set of filters: keys sorted (callers build them with
 * spreads) and `undefined` dropped (`{ q: undefined }` and `{}` are the same question).
 */
export function filterKey(filters: object): string {
  return JSON.stringify(
    Object.entries(filters)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

export interface ListQueryResult<TItem> {
  items: TItem[];
  total: number;
  page: number;
  pageSize: PageSizeOption;
  /** A first load with nothing to show. Not `isPending` (true when disabled) or `isFetching`. */
  isLoading: boolean;
  /** Whether a page has ever arrived — the footer stays hidden until one has. */
  hasLoaded: boolean;
  /** A page that did not arrive. Without it a failed list renders as an empty one. */
  isError: boolean;
  retry: () => void;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  /** Spread straight onto `<Pagination />`. */
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
    pageSizeOptions: readonly number[];
  };
}

/** A filtered, paginated list: the page resets on new filters and the rows hold still while one loads. */
export function useListQuery<TItem, TFilters extends object>(options: {
  /** Include everything the fetch depends on EXCEPT page and pageSize. */
  queryKey: QueryKey;
  filters: TFilters;
  fetchPage: (params: TFilters & { page: number; pageSize: number }) => Promise<Paginated<TItem>>;
  enabled?: boolean;
}): ListQueryResult<TItem> {
  const { queryKey, filters, fetchPage, enabled = true } = options;

  const [pageSize, setPageSize] = useState<PageSizeOption>(PAGE_SIZE_DEFAULT);
  const [page, setPage] = useState(1);

  /** Reset during render, not in an effect: an effect lets one render escape with the old page. */
  const key = filterKey(filters);
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setPage(1);
  }

  const query = useQuery({
    queryKey: [...(Array.isArray(queryKey) ? queryKey : [queryKey]), { filters, page, pageSize }],
    queryFn: () => fetchPage({ ...filters, page, pageSize }),
    placeholderData: keepPreviousData,
    enabled,
  });

  // A plain number: the calling control knows nothing about the allowed sizes.
  const resize = useCallback((size: number) => {
    if (isPageSizeOption(size)) setPageSize(size);
    // Widening to 100 rows on page 3 lands past the end; the reader asked to see more, not nothing.
    setPage(1);
  }, []);

  const total = query.data?.total ?? 0;

  return {
    items: query.data?.items ?? [],
    total,
    page,
    pageSize,
    isLoading: query.isLoading,
    hasLoaded: query.data !== undefined,
    isError: query.isError,
    retry: query.refetch,
    setPage,
    setPageSize: resize,
    pagination: {
      // The served page and size, not the requested: the rows on screen are still the old ones.
      page: query.data?.page ?? page,
      pageSize: query.data?.pageSize ?? pageSize,
      total,
      onPageChange: setPage,
      onPageSizeChange: resize,
      pageSizeOptions: PAGE_SIZE_OPTIONS,
    },
  };
}
