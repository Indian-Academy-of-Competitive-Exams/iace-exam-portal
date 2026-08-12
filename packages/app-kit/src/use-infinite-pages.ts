import { useCallback } from 'react';
import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { type Paginated } from '@iace/contracts';

/**
 * Whether there is another page after this one, and which.
 *
 * Pure and exported because it is the whole correctness of an infinite list,
 * and both ways of getting it wrong are silent: stop one page early and items
 * simply do not exist as far as the reader is concerned; fail to stop and the
 * list requests page after empty page forever while the spinner never leaves.
 *
 * Counts what has been LOADED rather than trusting `page + 1`, so a page that
 * comes back short — the last one, or a row deleted between requests — ends the
 * list rather than starting an empty one.
 */
export function nextPageParam(lastPage: Paginated<unknown>, loadedPages: number): number | null {
  const loaded = (lastPage.page - 1) * lastPage.pageSize + lastPage.items.length;

  if (lastPage.items.length === 0) return null;
  if (loaded >= lastPage.total) return null;

  // `loadedPages` rather than `lastPage.page + 1`: the server echoes back the
  // page it served, and a server that ignored the parameter would otherwise
  // have us ask for the same page for ever.
  return loadedPages + 1;
}

/**
 * Pages of a list, accumulated as they are asked for.
 *
 * The page SIZE stays whatever the API serves — this does not widen a request,
 * it just keeps asking for the next one. Which means a control backed by it
 * shows everything eventually, instead of silently ending at the first page and
 * looking complete.
 *
 * `queryKey` must include whatever the fetch depends on (a search term, a
 * parent filter); React Query then discards the accumulated pages when it
 * changes, which is exactly right — the old pages answered a different question.
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
   * Stable across renders, and that matters: whatever watches for "the reader
   * reached the end" attaches to this. A new function identity every render
   * tears that listener down and rebuilds it constantly, and it never settles
   * long enough to fire — the list loads its first page and then simply stops,
   * looking like there was nothing more.
   *
   * The guard lives here rather than at the call site because the thing asking
   * fires repeatedly while the end stays in view.
   */
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    total: query.data?.pages[0]?.total ?? 0,
    hasMore: hasNextPage,
    loadMore,
    isLoading: query.isPending,
    isLoadingMore: isFetchingNextPage,
  };
}
