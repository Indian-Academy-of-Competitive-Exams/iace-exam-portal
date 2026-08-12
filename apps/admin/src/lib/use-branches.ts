import { useQuery } from '@tanstack/react-query';
import { PAGE_SIZE_MAX, type Branch } from '@iace/contracts';
import { api } from './api';

/**
 * The branch list, unpaged.
 *
 * Fetching all of them in one go is right here and nowhere else in the app:
 * branches are a deliberately small, slow-moving list that only a super admin
 * adds to, and every screen that touches a group needs the whole thing at once
 * to render a picker. `staleTime` is long for the same reason — re-fetching a
 * list that changes a few times a year on every mount is pure noise.
 */
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
