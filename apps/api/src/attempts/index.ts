/** The attempts module's public surface (docs/03 §4.1). The rules stay private. */
export { AttemptsModule } from './attempts.module';
export { LeaderboardService, type CohortFigures, type CohortSitting } from './leaderboard.service';
/** What makes a sitting count, lent so a report's own grouping cannot redefine it. */
export { COHORT_WHERE, IN_COHORT } from './ranking-sql';
export {
  StudentOverviewService,
  type StudentRollup,
  type StudentRollups,
} from './overview.service';
export { answersOf } from './answer-sheet';
/** A test's figures and its report's sheets, for a report that prints one of them. */
export { TestAnalyticsService } from './test-analytics.service';
export { TestReportSheets, type ResultRow, type SummaryRow } from './test-report';
