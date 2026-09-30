/**
 * The admin's way into a student's report, named in the path and paid for with STUDENT_PERFORMANCE.
 * A student reads the same figures for one sitting off its score card, and the calendar here.
 */
import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ActorTypes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  performanceReportQuerySchema,
  type PerformanceReport,
  type PerformanceReportQuery,
  type TestCalendar,
} from '@iace/contracts';
import { Actors, CurrentUser, RequiresFeature, type AuthenticatedUser } from '../common/security';
import { ZodQuery } from '../common/zod-validation.pipe';
import { PerformanceAnalyticsService } from './performance.service';

@Controller('me/performance')
@Actors(ActorTypes.STUDENT)
export class MePerformanceController {
  constructor(private readonly performance: PerformanceAnalyticsService) {}

  /** Which days a test was sat on since the account opened. The calendar's only read. */
  @Get('days')
  testDays(@CurrentUser() user: AuthenticatedUser): Promise<TestCalendar> {
    return this.performance.testDays(user.id);
  }
}

@Controller('admin/students/:studentId/performance')
@Actors(ActorTypes.ADMIN)
export class AdminPerformanceController {
  constructor(private readonly performance: PerformanceAnalyticsService) {}

  /** The figures a student's score card reads, at any scope, for a student in the admin's branches. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_PERFORMANCE, PERMISSION_LEVELS.READ)
  @Get()
  report(
    @Param('studentId') studentId: string,
    @Query(new ZodQuery(performanceReportQuerySchema)) query: PerformanceReportQuery,
  ): Promise<PerformanceReport> {
    return this.performance.forStudent(studentId, query);
  }
}
