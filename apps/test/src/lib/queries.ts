import { queryOptions } from '@tanstack/react-query';
import { PERFORMANCE_SCOPES } from '@iace/contracts';
import { api } from './api';
import {
  CATALOG_QUERY_KEY,
  OVERVIEW_QUERY_KEY,
  PERFORMANCE_QUERY_KEY,
  briefQueryKey,
  performanceReportQueryKey,
  scoreCardQueryKey,
  solutionsQueryKey,
} from './constants';

/** The reads several screens share, each keyed once, so two screens can never cache one read twice. */

export const catalogQuery = queryOptions({
  queryKey: CATALOG_QUERY_KEY,
  queryFn: () => api.me.catalog(),
});

export const performanceQuery = queryOptions({
  queryKey: PERFORMANCE_QUERY_KEY,
  queryFn: () => api.me.performance(),
});

export const overviewQuery = queryOptions({
  queryKey: OVERVIEW_QUERY_KEY,
  queryFn: () => api.me.overview(),
});

export const briefQuery = (testId: string) =>
  queryOptions({ queryKey: briefQueryKey(testId), queryFn: () => api.me.testBrief(testId) });

export const scoreCardQuery = (attemptId: string) =>
  queryOptions({
    queryKey: scoreCardQueryKey(attemptId),
    queryFn: () => api.me.scoreCard(attemptId),
  });

export const solutionsQuery = (attemptId: string) =>
  queryOptions({
    queryKey: solutionsQueryKey(attemptId),
    queryFn: () => api.me.solutions(attemptId),
  });

export const attemptReportQuery = (attemptId: string) =>
  queryOptions({
    queryKey: performanceReportQueryKey(PERFORMANCE_SCOPES.ATTEMPT, attemptId),
    queryFn: () => api.me.performanceReport({ scope: PERFORMANCE_SCOPES.ATTEMPT, attemptId }),
  });
