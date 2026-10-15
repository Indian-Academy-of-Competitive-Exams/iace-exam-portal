import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigsModule } from '../configs';
import { NotificationsModule } from '../notifications';
import { ReachModule } from '../reach';
import {
  ProgramsController,
  StudentGrantsController,
  StudentSeriesController,
  TestSeriesController,
} from './access.controller';
import { ProgramsService } from './programs.service';
import { TestSeriesService } from './test-series.service';
import { StudentGrantsService } from './student-grants.service';
import { API_ROLES, onRole } from '../config/api-role';

/** Owns `Program`, `TestSeries` and `StudentGrant` — how a test is reached. */
@Module({
  imports: [PrismaModule, ReachModule, ConfigsModule, NotificationsModule],
  controllers: onRole(
    [API_ROLES.CORE],
    [ProgramsController, TestSeriesController, StudentGrantsController, StudentSeriesController],
  ),
  providers: [ProgramsService, TestSeriesService, StudentGrantsService],
  exports: [ProgramsService, TestSeriesService, StudentGrantsService, ReachModule],
})
export class AccessModule {}
