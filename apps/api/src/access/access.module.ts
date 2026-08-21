import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { ConfigsModule } from '../configs';
import {
  ProgramsController,
  StudentGrantsController,
  TestSeriesController,
  UnlockRequestsController,
} from './access.controller';
import { ProgramsService } from './programs.service';
import { TestSeriesService } from './test-series.service';
import { StudentGrantsService } from './student-grants.service';
import { AccessResolverService } from './access-resolver.service';
import { AccessCacheListener } from './access-cache.listener';
import { UnlocksService } from './unlocks.service';

/**
 * Owns `Program`, `TestSeries`, `BranchTestConfig` and `StudentGrant` — how a test is reached —
 * plus `StudentSeriesUnlock` and `SeriesUnlockRequest`, which say who has been let past a lock.
 */
@Module({
  imports: [PrismaModule, RedisModule, ConfigsModule],
  controllers: [
    ProgramsController,
    TestSeriesController,
    StudentGrantsController,
    UnlockRequestsController,
  ],
  providers: [
    ProgramsService,
    TestSeriesService,
    StudentGrantsService,
    AccessResolverService,
    AccessCacheListener,
    UnlocksService,
  ],
  exports: [
    ProgramsService,
    TestSeriesService,
    StudentGrantsService,
    AccessResolverService,
    UnlocksService,
  ],
})
export class AccessModule {}
