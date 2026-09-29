import { createStudentQueries } from '@iace/app-kit';
import { api } from './api';

export const {
  attemptReportQuery,
  briefQuery,
  catalogQuery,
  overviewQuery,
  performanceQuery,
  questionReportQuery,
  scoreCardQuery,
  testPaperQuery,
  solutionsQuery,
} = createStudentQueries(api);
