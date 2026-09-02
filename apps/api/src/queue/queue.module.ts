import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { Redis } from 'ioredis';
import { AppConfigService } from '../config/app-config.service';
import { QUEUE_NAMES, jobOptionsFor, type QueueName } from './queues';

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
      }),
    }),
    // Its own retries and retention per queue: a scoring failure is not a nightly prune.
    ...Object.values(QUEUE_NAMES).map((name: QueueName) =>
      BullModule.registerQueue({ name, defaultJobOptions: jobOptionsFor(name) }),
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
