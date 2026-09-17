import { queryOptions, skipToken } from '@tanstack/react-query';
import { type EndedSitting } from '@iace/app-kit';
import { PERFORMANCE_SCOPES } from '@iace/contracts';
import { api } from './api';
import {
  briefQueryKey,
  CATALOG_QUERY_KEY,
  endedSittingQueryKey,
  PERFORMANCE_QUERY_KEY,
  performanceReportQueryKey,
  questionReportQueryKey,
  scoreCardQueryKey,
  solutionsQueryKey,
} from './constants';

/** The reads the tests tab and the series page share, each keyed once. */

export const catalogQuery = queryOptions({
  queryKey: CATALOG_QUERY_KEY,
  queryFn: () => api.me.catalog(),
});

export const performanceQuery = queryOptions({
  queryKey: PERFORMANCE_QUERY_KEY,
  queryFn: () => api.me.performance(),
});

export const briefQuery = (testId: string) =>
  queryOptions({ queryKey: briefQueryKey(testId), queryFn: () => api.me.testBrief(testId) });

export const scoreCardQuery = (attemptId: string) =>
  queryOptions({
    queryKey: scoreCardQueryKey(attemptId),
    queryFn: () => api.me.scoreCard(attemptId),
  });

/** Never fetched: the exam writes it as the paper goes in, and a killed process simply has none. */
export const endedSittingQuery = (attemptId: string) =>
  queryOptions<EndedSitting>({ queryKey: endedSittingQueryKey(attemptId), queryFn: skipToken });

export const attemptReportQuery = (attemptId: string) =>
  queryOptions({
    queryKey: performanceReportQueryKey(PERFORMANCE_SCOPES.ATTEMPT, attemptId),
    queryFn: () => api.me.performanceReport({ scope: PERFORMANCE_SCOPES.ATTEMPT, attemptId }),
  });

export const solutionsQuery = (attemptId: string) =>
  queryOptions({
    queryKey: solutionsQueryKey(attemptId),
    queryFn: () => api.me.solutions(attemptId),
  });

export const questionReportQuery = (attemptId: string) =>
  queryOptions({
    queryKey: questionReportQueryKey(attemptId),
    queryFn: () => api.me.questionReport(attemptId),
  });
