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
/** One sitting's card, a paper's own marks and a section column read back: a student's report is these. */
export { PerformanceAnalyticsService } from './performance.service';
export { AttemptReportService } from './attempt-report.service';
export { sectionScoresIn } from './score-paper';
export { PaperSheetService, type PaperTerm } from './paper-sheet.service';
export { questionTalliesOf, type QuestionTally } from './question-tallies';
/** A voided sitting's audit row, told apart from the suspension it is filed beside. */
export { isSupportDiff } from './attempt-resolution';
