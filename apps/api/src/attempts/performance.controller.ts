/**
 * The two ways into one report. The student's path takes its subject from the token and cannot
 * name anybody; the admin's names one in the path and pays for it with STUDENT_PERFORMANCE.
 */
import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ActorTypes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  performanceReportQuerySchema,
  practiceDaysQuerySchema,
  type PerformanceReport,
  type PerformanceReportQuery,
  type PracticeDay,
  type PracticeDaysQuery,
  type SatSeries,
} from '@iace/contracts';
import { Actors, CurrentUser, RequiresFeature, type AuthenticatedUser } from '../common/security';
import { ZodQuery } from '../common/zod-validation.pipe';
import { PerformanceAnalyticsService } from './performance.service';

@Controller('me/performance')
@Actors(ActorTypes.STUDENT)
export class MePerformanceController {
  constructor(private readonly performance: PerformanceAnalyticsService) {}

  /** One sitting, one paper, one series or the whole career — never anybody else's. */
  @Get('report')
  report(
    @Query(new ZodQuery(performanceReportQuerySchema)) query: PerformanceReportQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PerformanceReport> {
    return this.performance.report(user.id, query);
  }

  /** Which days were practised, from a civil date the caller names. The calendar's only read. */
  @Get('days')
  practiceDays(
    @Query(new ZodQuery(practiceDaysQuerySchema)) query: PracticeDaysQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PracticeDay[]> {
    return this.performance.practiceDays(user.id, query.from);
  }

  /** What the SERIES scope may be asked about — a series they have sat, and whether it is a ramp. */
  @Get('series')
  series(@CurrentUser() user: AuthenticatedUser): Promise<SatSeries[]> {
    return this.performance.satSeries(user.id);
  }
}

@Controller('admin/students/:studentId/performance')
@Actors(ActorTypes.ADMIN)
export class AdminPerformanceController {
  constructor(private readonly performance: PerformanceAnalyticsService) {}

  /** The same payload the student reads, for any student in the admin's own branches. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_PERFORMANCE, PERMISSION_LEVELS.READ)
  @Get()
  report(
    @Param('studentId') studentId: string,
    @Query(new ZodQuery(performanceReportQuerySchema)) query: PerformanceReportQuery,
  ): Promise<PerformanceReport> {
    return this.performance.forStudent(studentId, query);
  }
}
