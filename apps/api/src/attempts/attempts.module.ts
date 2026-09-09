import { Module, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import { ATTEMPT_FLUSH_EVERY_MS, ATTEMPT_SWEEP_EVERY_MS, QUEUE_NAMES } from '../queue/queues';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { QueueModule } from '../queue/queue.module';
import { AccessModule } from '../access';
import { NotificationsModule } from '../notifications';
import { AttemptsController } from './attempts.controller';
import { AdminPerformanceController, MePerformanceController } from './performance.controller';
import { AdminOverviewController, MeOverviewController } from './overview.controller';
import { MeLeaderboardController } from './leaderboard.controller';
import {
  AdminPerformanceShareController,
  MePerformanceShareController,
  PublicReportController,
} from './performance-share.controller';
import {
  AdminQuestionReportController,
  MeQuestionReportController,
} from './question-report.controller';
import { QuestionReportService } from './question-report.service';
import { AdminTestAnalyticsController } from './test-analytics.controller';
import { TestAnalyticsService } from './test-analytics.service';
import { PerformanceShareService } from './performance-share.service';
import { LeaderboardViewService } from './leaderboard-view.service';
import { PerformanceAnalyticsService } from './performance.service';
import { StudentOverviewService } from './overview.service';
import { AttemptsService } from './attempts.service';
import { AttemptPaperService } from './attempt-paper.service';
import { AttemptReportService } from './attempt-report.service';
import { AttemptStateService } from './attempt-state.service';
import { AttemptFlushProcessor } from './attempt-flush.processor';
import { AttemptSweeperProcessor } from './attempt-sweeper.processor';
import { LeaderboardRebuildProcessor } from './leaderboard-rebuild.processor';
import { LeaderboardService } from './leaderboard.service';
import { RollupOutbox } from './rollup-outbox';
import { RollupProcessor } from './rollup.processor';
import { RollupService } from './rollup.service';
import { ScoringOutbox } from './scoring-outbox';
import { ScoringProcessor } from './scoring.processor';
import { SubmitService } from './submit.service';

/** Owns `Attempt` — the live sitting. AccessModule because the start guard is the catalog's own. */
@Module({
  imports: [PrismaModule, RedisModule, QueueModule, AccessModule, NotificationsModule],
  controllers: [
    AttemptsController,
    MePerformanceController,
    AdminPerformanceController,
    MeOverviewController,
    AdminOverviewController,
    MeLeaderboardController,
    PublicReportController,
    MePerformanceShareController,
    AdminPerformanceShareController,
    MeQuestionReportController,
    AdminQuestionReportController,
    AdminTestAnalyticsController,
  ],
  providers: [
    AttemptsService,
    AttemptPaperService,
    AttemptReportService,
    AttemptStateService,
    LeaderboardService,
    LeaderboardViewService,
    PerformanceAnalyticsService,
    PerformanceShareService,
    StudentOverviewService,
    QuestionReportService,
    TestAnalyticsService,
    LeaderboardRebuildProcessor,
    RollupOutbox,
    RollupProcessor,
    RollupService,
    ScoringOutbox,
    ScoringProcessor,
    SubmitService,
    AttemptFlushProcessor,
    AttemptSweeperProcessor,
  ],
  // Neither processor is here on purpose: an export is how a worker reaches a request path.
  exports: [
    AttemptsService,
    AttemptPaperService,
    AttemptStateService,
    LeaderboardService,
    ScoringOutbox,
    SubmitService,
  ],
})
export class AttemptsModule implements OnModuleInit {
  constructor(
    @InjectQueue(QUEUE_NAMES.ATTEMPT_FLUSH) private readonly flushQueue: Queue,
    @InjectQueue(QUEUE_NAMES.ATTEMPT_SWEEP) private readonly sweepQueue: Queue,
  ) {}

  /** Fixed scheduler ids: what stops a redeploy from stacking a second one on the same queue. */
  async onModuleInit(): Promise<void> {
    await this.flushQueue.upsertJobScheduler(QUEUE_NAMES.ATTEMPT_FLUSH, {
      every: ATTEMPT_FLUSH_EVERY_MS,
    });
    await this.sweepQueue.upsertJobScheduler(QUEUE_NAMES.ATTEMPT_SWEEP, {
      every: ATTEMPT_SWEEP_EVERY_MS,
    });
  }
}
