import { createStudentQueries } from '@iace/app-kit';
import { api } from './api';

export const {
  briefQuery,
  catalogQuery,
  overviewQuery,
  performanceQuery,
  questionReportQuery,
  scoreCardQuery,
  testPaperQuery,
  solutionsQuery,
  savedSolutionQuery,
} = createStudentQueries(api);
