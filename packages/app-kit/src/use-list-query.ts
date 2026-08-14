import { useCallback, useState } from 'react';
import { keepPreviousData, useQuery, type QueryKey } from '@tanstack/react-query';
import { PAGE_SIZE_OPTIONS, type Paginated, type PageSizeOption } from '@iace/contracts';
import { usePageSize } from './use-page-size';

/**
 * A stable identity for one set of filters.
 *
 * Both halves are load-bearing, and both failures look like the table jumping
 * back to page 1 for no reason a reader could name:
 *
 *  - **Keys are sorted.** Callers build these objects with spreads whose shape
 *    depends on the filter (`{ ...STATUS_QUERY[status], q }`), so the same
 *    logical filter set can arrive with its keys in a different order.
 *  - **`undefined` is dropped.** `{ q: undefined }` and `{}` are the same
 *    question — a filter that is not set — and must not read as a change.
 *
 * Exported because it is the whole correctness of the page reset, and it is
 * pure, so it can be asserted without rendering anything.
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
  /**
   * Whether to show a loading state — a FIRST load with nothing to show yet.
   *
   * Not `isPending`, which stays true for a query that is switched off and
   * would leave such a list saying "Loading…" for ever. And not `isFetching`,
   * which is true while the next page is on its way and would blank a table
   * that is still perfectly readable.
   */
  isLoading: boolean;
  /** Whether a page has ever arrived — the footer stays hidden until one has. */
  hasLoaded: boolean;
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

/**
 * A filtered, paginated list — the pattern behind every table in the admin app.
 *
 * It exists for three behaviours that are individually small and were
 * individually forgotten at least once:
 *
 * 1. **The page resets when the filters change.** Page 4 of the old result set
 *    is usually past the end of the new one, and an empty table reads as
 *    "there are none" rather than "you are too far in". Every screen was doing
 *    this by calling `setPage(1)` inside each filter handler — which works
 *    until someone adds a seventh filter and only wires six.
 * 2. **The rows hold still while the next page loads** (`keepPreviousData`).
 *    Without it the table empties on every keystroke of a search box and the
 *    page height jumps under the reader's cursor.
 * 3. **The page size comes from `usePageSize`**, so it is per-list and capped
 *    to what the API will actually accept.
 *
 * The FILTERS stay the caller's, because where they live is the caller's
 * decision — the admin screens keep them in the URL so a link into a screen and
 * the controls on it are the same state, and a future screen might not.
 */
export function useListQuery<TItem, TFilters extends object>(options: {
  /** Include everything the fetch depends on EXCEPT page and pageSize. */
  queryKey: QueryKey;
  filters: TFilters;
  fetchPage: (params: TFilters & { page: number; pageSize: number }) => Promise<Paginated<TItem>>;
  enabled?: boolean;
}): ListQueryResult<TItem> {
  const { queryKey, filters, fetchPage, enabled = true } = options;

  const [pageSize, choosePageSize] = usePageSize();
  const [page, setPage] = useState(1);

  /**
   * Reset during render rather than in an effect.
   *
   * An effect would let one render escape with the new filters and the old page
   * number — which is a request for page 4 of a result set that has three, and
   * a visible flash of "nothing found" before the corrected request lands. This
   * is React's documented adjust-state-on-change pattern: the extra render
   * happens before anything is committed to the screen.
   */
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

  const setPageSize = useCallback(
    (size: number) => {
      choosePageSize(size);
      // Widening from 20 to 100 rows while on page 3 usually lands past the
      // end. The reader asked to see more, not to be told there is nothing.
      setPage(1);
    },
    [choosePageSize],
  );

  const total = query.data?.total ?? 0;

  return {
    items: query.data?.items ?? [],
    total,
    page,
    pageSize,
    isLoading: query.isLoading,
    hasLoaded: query.data !== undefined,
    setPage,
    setPageSize,
    pagination: {
      // The SERVED page and size, not the requested ones: while the next page
      // is in flight the rows on screen are still the old ones, and a footer
      // that has already moved on describes a table nobody is looking at.
      page: query.data?.page ?? page,
      pageSize: query.data?.pageSize ?? pageSize,
      total,
      onPageChange: setPage,
      onPageSizeChange: setPageSize,
      pageSizeOptions: PAGE_SIZE_OPTIONS,
    },
  };
}
