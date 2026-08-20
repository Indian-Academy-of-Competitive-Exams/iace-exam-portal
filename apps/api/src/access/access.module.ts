import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigsModule } from '../configs';
import {
  ProgramsController,
  StudentGrantsController,
  TestSeriesController,
} from './access.controller';
import { ProgramsService } from './programs.service';
import { TestSeriesService } from './test-series.service';
import { StudentGrantsService } from './student-grants.service';

/** Owns `Program`, `TestSeries`, `BranchTestConfig` and `StudentGrant` — how a test is reached. */
@Module({
  imports: [PrismaModule, ConfigsModule],
  controllers: [ProgramsController, TestSeriesController, StudentGrantsController],
  providers: [ProgramsService, TestSeriesService, StudentGrantsService],
  exports: [ProgramsService, TestSeriesService, StudentGrantsService],
})
export class AccessModule {}
