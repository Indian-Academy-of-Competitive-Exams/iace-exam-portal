import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { ConfigsModule } from '../configs';
import {
  ProgramsController,
  StudentGrantsController,
  StudentSeriesController,
  TestSeriesController,
} from './access.controller';
import { ProgramsService } from './programs.service';
import { TestSeriesService } from './test-series.service';
import { StudentGrantsService } from './student-grants.service';
import { AccessResolverService } from './access-resolver.service';
import { AccessCacheListener } from './access-cache.listener';

/** Owns `Program`, `TestSeries`, `BranchTestConfig` and `StudentGrant` — how a test is reached. */
@Module({
  imports: [PrismaModule, RedisModule, ConfigsModule],
  controllers: [
    ProgramsController,
    TestSeriesController,
    StudentGrantsController,
    StudentSeriesController,
  ],
  providers: [
    ProgramsService,
    TestSeriesService,
    StudentGrantsService,
    AccessResolverService,
    AccessCacheListener,
  ],
  exports: [ProgramsService, TestSeriesService, StudentGrantsService, AccessResolverService],
})
export class AccessModule {}
