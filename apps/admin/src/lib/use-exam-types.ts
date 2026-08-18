import { useQuery } from '@tanstack/react-query';
import { PAGE_SIZE_MAX, type ExamType } from '@iace/contracts';
import { api } from './api';

/** The exam-type list, unpaged and long-cached: a small list that changes a few times a year. */
export function useExamTypes(options: { activeOnly?: boolean } = {}): ExamType[] {
  const { activeOnly } = options;

  const query = useQuery({
    queryKey: ['admin', 'exam-types', { activeOnly: activeOnly ?? false }],
    queryFn: () =>
      api.admin.examTypes.list({
        pageSize: PAGE_SIZE_MAX,
        ...(activeOnly ? { activeOnly: 'true' as const } : {}),
      }),
    staleTime: 5 * 60_000,
  });

  return query.data?.items ?? [];
}
