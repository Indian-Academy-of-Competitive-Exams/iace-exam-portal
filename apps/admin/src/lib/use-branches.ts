import { useQuery } from '@tanstack/react-query';
import { PAGE_SIZE_MAX, type Branch } from '@iace/contracts';
import { api } from './api';

/** The branch list, unpaged and long-cached: a small list that changes a few times a year. */
export function useBranches(options: { activeOnly?: boolean } = {}): Branch[] {
  const { activeOnly } = options;

  const query = useQuery({
    queryKey: ['admin', 'branches', { activeOnly: activeOnly ?? false }],
    queryFn: () =>
      api.admin.branches.list({
        pageSize: PAGE_SIZE_MAX,
        ...(activeOnly ? { activeOnly: 'true' as const } : {}),
      }),
    staleTime: 5 * 60_000,
  });

  return query.data?.items ?? [];
}
