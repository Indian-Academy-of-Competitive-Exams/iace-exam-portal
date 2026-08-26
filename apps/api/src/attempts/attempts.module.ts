import { Module, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import { ATTEMPT_FLUSH_EVERY_MS, QUEUE_NAMES } from '../queue/queues';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { QueueModule } from '../queue/queue.module';
import { AccessModule } from '../access';
import { AttemptsController } from './attempts.controller';
import { AttemptsService } from './attempts.service';
import { AttemptPaperService } from './attempt-paper.service';
import { AttemptStateService } from './attempt-state.service';
import { AttemptFlushProcessor } from './attempt-flush.processor';

/** Owns `Attempt` — the live sitting. AccessModule because the start guard is the catalog's own. */
@Module({
  imports: [PrismaModule, RedisModule, QueueModule, AccessModule],
  controllers: [AttemptsController],
  providers: [AttemptsService, AttemptPaperService, AttemptStateService, AttemptFlushProcessor],
  exports: [AttemptsService, AttemptPaperService, AttemptStateService],
})
export class AttemptsModule implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_NAMES.ATTEMPT_FLUSH) private readonly flushQueue: Queue) {}

  /** Fixed scheduler id: what stops a redeploy from stacking a second flusher on the same queue. */
  async onModuleInit(): Promise<void> {
    await this.flushQueue.upsertJobScheduler(QUEUE_NAMES.ATTEMPT_FLUSH, {
      every: ATTEMPT_FLUSH_EVERY_MS,
    });
  }
}
