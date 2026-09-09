/** The attempts module's public surface (docs/03 §4.1). The rules stay private. */
export { AttemptsModule } from './attempts.module';
export { AttemptsService } from './attempts.service';
export { AttemptPaperService } from './attempt-paper.service';
export { LeaderboardService } from './leaderboard.service';
export { ScoringOutbox } from './scoring-outbox';
/** Pure, and the ONE definition of when a key may be seen — anything gating on it borrows these. */
