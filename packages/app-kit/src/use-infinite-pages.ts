import { useCallback } from 'react';
import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { type Paginated } from '@iace/contracts';

/**
 * Whether there is another page, and which. Counts what has been LOADED, so a short
 * page ends the list rather than starting an empty one.
 */
export function nextPageParam(lastPage: Paginated<unknown>, loadedPages: number): number | null {
  const loaded = (lastPage.page - 1) * lastPage.pageSize + lastPage.items.length;

  if (lastPage.items.length === 0) return null;
  if (loaded >= lastPage.total) return null;

  // `loadedPages`, not the echoed page: a server ignoring the parameter would loop.
  return loadedPages + 1;
}

/**
 * Pages accumulated as they are asked for; the page size stays whatever the API serves.
 * `queryKey` must include whatever the fetch depends on, so the pages reset with it.
 */
export function useInfinitePages<T>(options: {
  queryKey: QueryKey;
  fetchPage: (page: number) => Promise<Paginated<T>>;
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
  retry: () => void;
} {
  const { queryKey, fetchPage, enabled = true } = options;

  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    getNextPageParam: (lastPage, allPages) => nextPageParam(lastPage, allPages.length),
    enabled,
  });

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  /**
   * Stable across renders: whatever watches for the end attaches to this, and a new
   * identity each render tears that listener down before it can fire.
   */
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    total: query.data?.pages[0]?.total ?? 0,
    hasMore: hasNextPage,
    loadMore,
    isError: query.isError,
    retry: query.refetch,
    isLoading: query.isPending,
    isLoadingMore: isFetchingNextPage,
  };
}
