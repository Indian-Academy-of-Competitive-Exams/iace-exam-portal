import { useQuery } from '@tanstack/react-query';
import { PAGE_SIZE_MAX, type Exam } from '@iace/contracts';
import { api } from './api';
import { QUERY_KEYS } from './constants';

/** The list plus how the read went, so a picker with nothing in it can say which it is. */
export interface ExamList {
  exams: Exam[];
  isLoading: boolean;
  isError: boolean;
  retry: () => void;
}

/** The exam list, unpaged and long-cached: a small list that changes a few times a year. */
export function useExams(options: { activeOnly?: boolean; enabled?: boolean } = {}): ExamList {
  const { activeOnly, enabled } = options;

  const query = useQuery({
    queryKey: [...QUERY_KEYS.EXAMS, { activeOnly: activeOnly ?? false }],
    queryFn: () =>
      api.admin.exams.list({
        pageSize: PAGE_SIZE_MAX,
        ...(activeOnly ? { activeOnly: 'true' as const } : {}),
      }),
    staleTime: 5 * 60_000,
    enabled,
  });

  return {
    exams: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    retry: query.refetch,
  };
}
