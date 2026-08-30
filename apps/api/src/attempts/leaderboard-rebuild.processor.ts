/** Puts one test's board back from Postgres, off every request path — a wiped Redis is a job. */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job } from 'bullmq';
import { QUEUE_NAMES, type LeaderboardRebuildJobData } from '../queue/queues';
import { LeaderboardService } from './leaderboard.service';

@Processor(QUEUE_NAMES.LEADERBOARD_REBUILD)
export class LeaderboardRebuildProcessor extends WorkerHost {
  private readonly logger = new Logger(LeaderboardRebuildProcessor.name);

  constructor(private readonly leaderboard: LeaderboardService) {
    super();
  }

  async process(job: Job<LeaderboardRebuildJobData>): Promise<void> {
    const { testId } = job.data;
    const written = await this.leaderboard.rebuild(testId);
    this.logger.log(`Rebuilt the board for test ${testId} from ${written} scored sittings`);
  }
}
