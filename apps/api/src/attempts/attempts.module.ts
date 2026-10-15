import { Module, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import { ATTEMPT_FLUSH_EVERY_MS, ATTEMPT_SWEEP_EVERY_MS, QUEUE_NAMES } from '../queue/queues';
import { API_ROLES, onRole, servesRole } from '../config/api-role';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { keepScheduled } from '../queue/keep-scheduled';
import { QueueModule } from '../queue/queue.module';
import { AccessModule } from '../access';
import { NotificationsModule } from '../notifications';
import { AttemptsController } from './sitting/attempts.controller';
import { MeAttemptReportController } from './results/attempt-report.controller';
import { AdminLiveOpsController } from './sitting/live-ops.controller';
import {
  AdminPerformanceController,
  MePerformanceController,
} from './results/performance.controller';
import { MeOverviewController } from './results/overview.controller';
import { MeLeaderboardController } from './results/leaderboard.controller';
import { MeQuestionReportController } from './results/question-report.controller';
import { QuestionReportService } from './results/question-report.service';
import { AdminTestAnalyticsController } from './results/test-analytics.controller';
import { TestAnalyticsService } from './results/test-analytics.service';
import { LeaderboardViewService } from './results/leaderboard-view.service';
import { PerformanceAnalyticsService } from './results/performance.service';
import { StudentOverviewService } from './results/overview.service';
import { AttemptsService } from './sitting/attempts.service';
import { AttemptResolutionService } from './sitting/attempt-resolution.service';
import { LiveOpsService } from './sitting/live-ops.service';
import { AttemptPaperService } from './sitting/attempt-paper.service';
import { AdminPaperPrintController } from './results/paper-print.controller';
import { AttemptReportService } from './results/attempt-report.service';
import { AttemptStateService } from './sitting/attempt-state.service';
import { PaperSheetService } from './paper-sheet.service';
import { AttemptSheetService } from './sitting/attempt-sheet.service';
import { AttemptFlushProcessor } from './sitting/attempt-flush.processor';
import { AttemptSweeperProcessor } from './sitting/attempt-sweeper.processor';
import { LeaderboardService } from './results/leaderboard.service';
import { RollupQueue } from './results/rollup-queue';
import { RollupProcessor } from './results/rollup.processor';
import { RollupService } from './results/rollup.service';
import { ScoringQueue } from './scoring/scoring-queue';
import { ScoringProcessor } from './scoring/scoring.processor';
import { SubmitService } from './sitting/submit.service';

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
        MeQuestionReportController,
        AdminTestAnalyticsController,
        AdminPaperPrintController,
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
    ScoringQueue,
    SubmitService,
    ...onRole(
      [API_ROLES.WORKER],
      [ScoringProcessor, RollupProcessor, AttemptFlushProcessor, AttemptSweeperProcessor],
    ),
  ],
  // Neither processor is here on purpose: an export is how a worker reaches a request path.
  exports: [
    LeaderboardService,
    StudentOverviewService,
    TestAnalyticsService,
    PerformanceAnalyticsService,
    AttemptReportService,
    PaperSheetService,
  ],
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

    await keepScheduled(this.flushQueue, async () => {
      await this.flushQueue.upsertJobScheduler(QUEUE_NAMES.ATTEMPT_FLUSH, {
        every: ATTEMPT_FLUSH_EVERY_MS,
      });
      await this.sweepQueue.upsertJobScheduler(QUEUE_NAMES.ATTEMPT_SWEEP, {
        every: ATTEMPT_SWEEP_EVERY_MS,
      });
    });
  }
}
