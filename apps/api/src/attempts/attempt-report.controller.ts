/** What a sitting reads once it is over — never on the sitting's own clock, so it sits on core. */
import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ActorTypes,
  solutionsQuerySchema,
  type FieldEffort,
  type PerformanceTrend,
  type ScoreCard,
  type SolutionReport,
  type SolutionsQuery,
} from '@iace/contracts';
import { Actors, CurrentUser, type AuthenticatedUser } from '../common/security';
import { ZodQuery } from '../common/zod-validation.pipe';
import { AttemptReportService } from './attempt-report.service';
import { PerformanceAnalyticsService } from './performance.service';

@Controller('me')
@Actors(ActorTypes.STUDENT)
export class MeAttemptReportController {
  constructor(
    private readonly reports: AttemptReportService,
    private readonly analytics: PerformanceAnalyticsService,
  ) {}

  /** Marks, standing and the cohort beside them, for every report tab. Carries no question at all. */
  @Get('attempts/:id/scorecard')
  scoreCard(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<ScoreCard> {
    return this.analytics.scoreCard(user.id, id);
  }

  /** The cohort's effort beside a handed-in paper. No mark is in it, so it answers before marking has run. */
  @Get('attempts/:id/field')
  fieldEffort(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FieldEffort> {
    return this.analytics.fieldEffort(user.id, id);
  }

  /** The answer key, and the ONLY endpoint carrying it. One section at a time, refused until the gate opens. */
  @Get('attempts/:id/solutions')
  solutions(
    @Param('id') id: string,
    @Query(new ZodQuery(solutionsQuerySchema)) query: SolutionsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SolutionReport> {
    return this.reports.solutions(user.id, id, query);
  }

  /** Every test this student has sat, oldest first — the line the Performance tab draws. */
  @Get('performance')
  performance(@CurrentUser() user: AuthenticatedUser): Promise<PerformanceTrend> {
    return this.reports.performance(user.id);
  }
}
