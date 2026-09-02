import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { StorageModule } from '../storage/storage.module';
import { QUEUE_NAMES } from '../queue/queues';
import { HealthController } from './health.controller';

/** Declares its own infra rather than assuming `app.module` provides it (docs/03 §4.5). */
@Module({
  // It travels with every extracted service (docs/03 §8), so it wires the four it reports on itself.
  imports: [
    PrismaModule,
    RedisModule,
    StorageModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.SCORING }),
  ],
  controllers: [HealthController],
})
export class HealthModule {}
