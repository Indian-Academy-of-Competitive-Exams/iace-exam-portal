/** The attempts module's public surface (docs/03 §4.1). The rules stay private. */
export { AttemptsModule } from './attempts.module';
export {
  LeaderboardService,
  type CohortFigures,
  type CohortSitting,
} from './results/leaderboard.service';
/** What makes a sitting count, lent so a report's own grouping cannot redefine it. */
export { COHORT_WHERE, IN_COHORT } from './results/ranking-sql';
export {
  StudentOverviewService,
  type StudentRollup,
  type StudentRollups,
} from './results/overview.service';
export { answersOf } from './answer-sheet';
/** A test's figures and its report's sheets, for a report that prints one of them. */
export { TestAnalyticsService } from './results/test-analytics.service';
export {
  TestReportSheets,
  buildTestReport,
  type ResultRow,
  type SummaryRow,
} from './results/test-report';
/** One sitting's card, a paper's own marks and a section column read back: a student's report is these. */
export { PerformanceAnalyticsService } from './results/performance.service';
export { AttemptReportService } from './results/attempt-report.service';
export { sectionScoresIn } from './scoring/score-paper';
/** What one sitting typed at one place on its paper, for a report that scores it on read. */
export { typedIn } from './answer-sheet';
export { PaperSheetService, type PaperTerm } from './paper-sheet.service';
export { questionTalliesOf, type QuestionTally } from './results/question-tallies';
/** A voided sitting's audit row, told apart from the suspension it is filed beside. */
export { isSupportDiff } from './sitting/attempt-resolution';
