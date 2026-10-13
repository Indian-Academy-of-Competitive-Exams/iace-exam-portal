import { createStudentQueries } from '@iace/app-kit';
import { api } from './api';

export const {
  briefQuery,
  catalogQuery,
  fieldEffortQuery,
  overviewQuery,
  performanceQuery,
  ownReportQuery,
  questionReportQuery,
  scoreCardAheadQuery,
  scoreCardQuery,
  typingInAttemptQuery,
  testPaperQuery,
  solutionsQuery,
  savedSolutionQuery,
} = createStudentQueries(api);
