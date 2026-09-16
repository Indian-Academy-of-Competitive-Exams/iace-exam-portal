import { queryOptions } from '@tanstack/react-query';
import { api } from './api';
import { CATALOG_QUERY_KEY, PERFORMANCE_QUERY_KEY } from './constants';

/** The reads the tests tab and the series page share, each keyed once. */

export const catalogQuery = queryOptions({
  queryKey: CATALOG_QUERY_KEY,
  queryFn: () => api.me.catalog(),
});

export const performanceQuery = queryOptions({
  queryKey: PERFORMANCE_QUERY_KEY,
  queryFn: () => api.me.performance(),
});
