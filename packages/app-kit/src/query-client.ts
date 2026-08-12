import { QueryClient } from '@tanstack/react-query';

/**
 * The fetching policy every IACE SPA runs on.
 *
 * These are not per-app preferences, they are one judgement about the network
 * the platform lives on: students sit live timed tests over flaky mobile
 * connections, where a request worth retrying is worth retrying ONCE and a
 * client that hammers is worse than one that fails visibly. Refetch-on-focus is
 * off for the same reason — a student tabbing back mid-test should not trigger
 * a burst of requests.
 *
 * Kept here so the two app roots cannot drift into slightly different answers,
 * which is a difference nobody would ever have chosen deliberately.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  });
}
