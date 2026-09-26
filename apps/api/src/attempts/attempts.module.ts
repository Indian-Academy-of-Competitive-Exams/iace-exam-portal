import { Module, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import { ATTEMPT_FLUSH_EVERY_MS, ATTEMPT_SWEEP_EVERY_MS, QUEUE_NAMES } from '../queue/queues';
import { API_ROLES, onRole, servesRole } from '../config/api-role';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { QueueModule } from '../queue/queue.module';
import { AccessModule } from '../access';
import { NotificationsModule } from '../notifications';
import { AttemptsController } from './attempts.controller';
import { MeAttemptReportController } from './attempt-report.controller';
import { AdminLiveOpsController } from './live-ops.controller';
import { AdminPerformanceController, MePerformanceController } from './performance.controller';
import { AdminOverviewController, MeOverviewController } from './overview.controller';
import { MeLeaderboardController } from './leaderboard.controller';
import {
  AdminQuestionReportController,
  MeQuestionReportController,
} from './question-report.controller';
import { QuestionReportService } from './question-report.service';
import { AdminTestAnalyticsController } from './test-analytics.controller';
import { TestAnalyticsService } from './test-analytics.service';
import { LeaderboardViewService } from './leaderboard-view.service';
import { PerformanceAnalyticsService } from './performance.service';
import { StudentOverviewService } from './overview.service';
import { AttemptsService } from './attempts.service';
import { AttemptResolutionService } from './attempt-resolution.service';
import { LiveOpsService } from './live-ops.service';
import { AttemptPaperService } from './attempt-paper.service';
import { AttemptReportService } from './attempt-report.service';
import { AttemptStateService } from './attempt-state.service';
import { PaperSheetService } from './paper-sheet.service';
import { AttemptSheetService } from './attempt-sheet.service';
import { AttemptFlushProcessor } from './attempt-flush.processor';
import { AttemptSweeperProcessor } from './attempt-sweeper.processor';
import { LeaderboardService } from './leaderboard.service';
import { RollupQueue } from './rollup-queue';
import { RollupProcessor } from './rollup.processor';
import { RollupService } from './rollup.service';
import { ScoringOutbox } from './scoring-outbox';
import { ScoringProcessor } from './scoring.processor';
import { SubmitService } from './submit.service';

/** Owns `Attempt` — the live sitting. AccessModule because the start guard is the catalog's own. */
@Module({
  imports: [PrismaModule, RedisModule, QueueModule, AccessModule, NotificationsModule],
  controllers: [
    // The hall: starting, autosaving, submitting, and the board a candidate refreshes.
    ...onRole([API_ROLES.EXAM], [AttemptsController, MeLeaderboardController]),
    // Read after the paper is handed in, at a pace the sitting never sees.
    ...onRole(
      [API_ROLES.CORE],
      [
        AdminLiveOpsController,
        MeAttemptReportController,
        MePerformanceController,
        AdminPerformanceController,
        MeOverviewController,
        AdminOverviewController,
        MeQuestionReportController,
        AdminQuestionReportController,
        AdminTestAnalyticsController,
      ],
    ),
  ],
  providers: [
    AttemptsService,
    AttemptResolutionService,
    LiveOpsService,
    AttemptPaperService,
    AttemptReportService,
    AttemptStateService,
    PaperSheetService,
    AttemptSheetService,
    LeaderboardService,
    LeaderboardViewService,
    PerformanceAnalyticsService,
    StudentOverviewService,
    QuestionReportService,
    TestAnalyticsService,
    RollupQueue,
    RollupService,
    ScoringOutbox,
    SubmitService,
    ...onRole(
      [API_ROLES.WORKER],
      [ScoringProcessor, RollupProcessor, AttemptFlushProcessor, AttemptSweeperProcessor],
    ),
  ],
  // Neither processor is here on purpose: an export is how a worker reaches a request path.
  exports: [LeaderboardService, ScoringOutbox, StudentOverviewService],
})
export class AttemptsModule implements OnModuleInit {
  constructor(
    @InjectQueue(QUEUE_NAMES.ATTEMPT_FLUSH) private readonly flushQueue: Queue,
    @InjectQueue(QUEUE_NAMES.ATTEMPT_SWEEP) private readonly sweepQueue: Queue,
  ) {}

  /** Fixed scheduler ids: what stops a redeploy from stacking a second one on the same queue. */
  async onModuleInit(): Promise<void> {
    // The container that runs the jobs is the one that schedules them.
    if (!servesRole(API_ROLES.WORKER)) return;

    await this.flushQueue.upsertJobScheduler(QUEUE_NAMES.ATTEMPT_FLUSH, {
      every: ATTEMPT_FLUSH_EVERY_MS,
    });
    await this.sweepQueue.upsertJobScheduler(QUEUE_NAMES.ATTEMPT_SWEEP, {
      every: ATTEMPT_SWEEP_EVERY_MS,
    });
  }
}
