import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { StorageModule } from '../storage/storage.module';
import { HealthController } from './health.controller';

/** Declares its own infra rather than assuming `app.module` provides it (docs/03 §4.5). */
@Module({
  // The three things it reports on. It travels with every extracted service
  // (docs/03 §8), so it must not depend on the core app having wired them.
  imports: [PrismaModule, RedisModule, StorageModule],
  controllers: [HealthController],
})
export class HealthModule {}
