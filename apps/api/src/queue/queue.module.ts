import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { Redis } from 'ioredis';
import { AppConfigService } from '../config/app-config.service';
import { QUEUE_NAMES } from './queues';
import { ScoringProcessor } from './scoring.processor';

/**
 * BullMQ over the same Redis instance, on its own connection: workers issue blocking commands
 * (BRPOPLPUSH), which would stall the application client.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        connection: new Redis(config.get('REDIS_URL'), { maxRetriesPerRequest: null }),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 86400 },
        },
      }),
    }),
    BullModule.registerQueue({ name: QUEUE_NAMES.SCORING }),
    BullModule.registerQueue({ name: QUEUE_NAMES.AUDIT_ARCHIVE }),
    BullModule.registerQueue({ name: QUEUE_NAMES.ATTEMPT_FLUSH }),
    BullModule.registerQueue({ name: QUEUE_NAMES.ATTEMPT_SWEEP }),
    BullModule.registerQueue({ name: QUEUE_NAMES.OUTBOX_PRUNE }),
  ],
  providers: [ScoringProcessor],
  exports: [BullModule],
})
export class QueueModule {}
