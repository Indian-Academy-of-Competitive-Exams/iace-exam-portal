import { queryOptions, skipToken } from '@tanstack/react-query';
import { createStudentQueries, type EndedSitting } from '@iace/app-kit';
import { api } from './api';
import { endedSittingQueryKey } from './constants';

export const {
  briefQuery,
  catalogQuery,
  fieldEffortQuery,
  overviewQuery,
  performanceQuery,
  questionReportQuery,
  scoreCardAheadQuery,
  scoreCardQuery,
  testPaperQuery,
  solutionsQuery,
  savedSolutionQuery,
} = createStudentQueries(api);

/** Never fetched: the exam writes it as the paper goes in, and a killed process simply has none. */
export const endedSittingQuery = (attemptId: string) =>
  queryOptions<EndedSitting>({ queryKey: endedSittingQueryKey(attemptId), queryFn: skipToken });
