import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { StorageModule } from '../storage/storage.module';
import { QueueModule } from '../queue/queue.module';
import { HealthController } from './health.controller';

/** Declares its own infra rather than assuming `app.module` provides it (docs/03 §4.5). */
@Module({
  // It travels with every extracted service (docs/03 §8), so it wires the four it reports on itself.
  imports: [PrismaModule, RedisModule, StorageModule, QueueModule],
  controllers: [HealthController],
})
export class HealthModule {}
