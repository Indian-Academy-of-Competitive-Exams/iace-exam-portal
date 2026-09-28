import { queryOptions, skipToken } from '@tanstack/react-query';
import { createStudentQueries, type EndedSitting } from '@iace/app-kit';
import { api } from './api';
import { endedSittingQueryKey } from './constants';

export const {
  attemptReportQuery,
  briefQuery,
  catalogQuery,
  overviewQuery,
  performanceQuery,
  questionReportQuery,
  scoreCardQuery,
  solutionsQuery,
} = createStudentQueries(api);

/** Never fetched: the exam writes it as the paper goes in, and a killed process simply has none. */
export const endedSittingQuery = (attemptId: string) =>
  queryOptions<EndedSitting>({ queryKey: endedSittingQueryKey(attemptId), queryFn: skipToken });
