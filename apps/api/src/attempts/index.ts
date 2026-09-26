/** The attempts module's public surface (docs/03 §4.1). The rules stay private. */
export { AttemptsModule } from './attempts.module';
export { LeaderboardService } from './leaderboard.service';
export {
  StudentOverviewService,
  type StudentRollup,
  type StudentRollups,
} from './overview.service';
export { ScoringOutbox } from './scoring-outbox';
export { answersOf } from './answer-sheet';
