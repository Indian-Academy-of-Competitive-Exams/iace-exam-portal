import { useCallback, useState } from 'react';
import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { PAGE_SIZE_MAX, type Paginated } from '@iace/contracts';

/** Whether there is another page, and which; counts what has been LOADED, so a short page ends the list rather than starting an empty one. */
export function nextPageParam(lastPage: Paginated<unknown>, loadedPages: number): number | null {
  const loaded = (lastPage.page - 1) * lastPage.pageSize + lastPage.items.length;

  if (lastPage.items.length === 0) return null;
  if (loaded >= lastPage.total) return null;

  // `loadedPages`, not the echoed page: a server ignoring the parameter would loop.
  return loadedPages + 1;
}

/** What one page is asked for: its place in the list and, when cut by cursor, the row it follows. */
interface PageParam {
  page: number;
  after?: string;
}

const FIRST_PAGE: PageParam = { page: 1 };

/** Cut by cursor the end is a short page, since `total` shrinks as rows are read and would stop the list early. */
export function nextCursorParam<T>(
  lastPage: Paginated<T>,
  loadedPages: number,
  cursorOf: (item: T) => string,
): PageParam | null {
  const last = lastPage.items.at(-1);
  if (last === undefined || lastPage.items.length < lastPage.pageSize) return null;
  return { page: loadedPages + 1, after: cursorOf(last) };
}

const idOf = (item: unknown): unknown =>
  typeof item === 'object' && item !== null && 'id' in item ? item.id : undefined;

/** Every loaded row, once: pages are cut by position, so a row arriving between two loads repeats the one it pushed down. */
export function loadedItems<T>(pages: readonly Paginated<T>[]): T[] {
  const seen = new Set<unknown>();
  return pages
    .flatMap((page) => page.items)
    .filter((item) => {
      const id = idOf(item);
      if (id === undefined) return true;
      const repeated = seen.has(id);
      seen.add(id);
      return !repeated;
    });
}

/** Pages accumulate as asked for; page size stays whatever the API serves. `queryKey` must include whatever the fetch depends on, so pages reset with it. */
export function useInfinitePages<T>(options: {
  queryKey: QueryKey;
  /** `after` is `cursorOf` of the last row held, so a list that shrinks between loads still resumes where it stopped. */
  fetchPage: (page: number, signal?: AbortSignal, after?: string) => Promise<Paginated<T>>;
  /** Given, pages are cut after the last row held instead of by position. */
  cursorOf?: (item: T) => string;
  enabled?: boolean;
}): {
  items: T[];
  total: number;
  hasMore: boolean;
  loadMore: () => void;
  isLoading: boolean;
  isLoadingMore: boolean;
  /** "It did not load" and "there are none" are different facts, and read differently. */
  isError: boolean;
  /** The next page failed with rows already held: they stay, and the end of the list offers `loadMore` again. */
  isLoadMoreError: boolean;
  retry: () => void;
} {
  const { queryKey, fetchPage, cursorOf, enabled = true } = options;

  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: FIRST_PAGE,
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam.page, signal, pageParam.after),
    getNextPageParam: (lastPage, allPages): PageParam | null => {
      if (cursorOf) return nextCursorParam(lastPage, allPages.length, cursorOf);
      const page = nextPageParam(lastPage, allPages.length);
      return page === null ? null : { page };
    },
    enabled,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  /** Stable across renders: whatever watches for the end attaches to this, and a new identity each render tears that listener down before it can fire. */
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Paused offline, the read never ran: that is "did not load", not a skeleton with no end.
  const neverRan = query.isPaused && query.data === undefined;

  return {
    items: loadedItems(query.data?.pages ?? []),
    total: query.data?.pages[0]?.total ?? 0,
    hasMore: hasNextPage,
    loadMore,
    isError: query.isError || neverRan,
    isLoadMoreError: query.isFetchNextPageError,
    retry: query.refetch,
    isLoading: query.isPending && !neverRan,
    isLoadingMore: isFetchingNextPage,
  };
}

/** The query a paged picker sends: the largest page the API serves, searched on the server. */
export interface PickerPageParams {
  page: number;
  pageSize: number;
  q: string;
  /** Aborted when the search moves on, so a stale page is cancelled rather than downloaded. */
  signal?: AbortSignal;
}

/** Server-side search and paging, as the props a combobox spreads; a new search restarts at page one. */
export function usePagedPicker<T>(options: {
  queryKey: QueryKey;
  fetchPage: (params: PickerPageParams) => Promise<Paginated<T>>;
  enabled?: boolean;
}) {
  const [search, setSearch] = useState('');
  const pages = useInfinitePages({
    queryKey: [...options.queryKey, search],
    fetchPage: (page, signal) =>
      options.fetchPage({ page, pageSize: PAGE_SIZE_MAX, q: search, signal }),
    enabled: options.enabled,
  });

  return {
    items: pages.items,
    paging: {
      search,
      onSearchChange: setSearch,
      hasMore: pages.hasMore,
      onLoadMore: pages.loadMore,
      isLoading: pages.isLoading,
      isLoadingMore: pages.isLoadingMore,
      isError: pages.isError,
      onRetry: pages.retry,
    },
  };
}
