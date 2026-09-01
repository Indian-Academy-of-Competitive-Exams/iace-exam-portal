/**
 * Three doors onto one service. Only the FIRST is @Public(), and it is read-only and addressed
 * by a token nobody can guess — the mirror image of leaderboard.controller.ts, which asserts it
 * is not public for the same reason. Minting and revoking both require a signed-in identity.
 */
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ActorTypes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  createPerformanceShareSchema,
  type CreatePerformanceShareInput,
  type PerformanceShare,
  type PerformanceShares,
  type SharedReport,
} from '@iace/contracts';
import {
  Actors,
  CurrentUser,
  Public,
  RequiresFeature,
  type AuthenticatedUser,
} from '../common/security';
import { ZodBody } from '../common/zod-validation.pipe';
import { PerformanceShareService } from './performance-share.service';

@Controller('public/reports')
export class PublicReportController {
  constructor(private readonly shares: PerformanceShareService) {}

  /** The only unauthenticated route to student data: one student's own curated report. */
  @Public()
  @Get(':token')
  read(@Param('token') token: string): Promise<SharedReport> {
    return this.shares.readPublic(token);
  }
}

@Controller('me/performance/shares')
@Actors(ActorTypes.STUDENT)
export class MePerformanceShareController {
  constructor(private readonly shares: PerformanceShareService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<PerformanceShares> {
    return this.shares.list(user.id);
  }

  @Post()
  create(
    @Body(new ZodBody(createPerformanceShareSchema)) body: CreatePerformanceShareInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PerformanceShare> {
    return this.shares.create(user.id, body, null);
  }

  /** A student can always kill a link to their own data. */
  @Post(':id/revoke')
  revoke(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PerformanceShare> {
    return this.shares.revoke(user.id, id);
  }
}

@Controller('admin/students/:studentId/performance/shares')
@Actors(ActorTypes.ADMIN)
export class AdminPerformanceShareController {
  constructor(private readonly shares: PerformanceShareService) {}

  @RequiresFeature(FEATURE_KEYS.STUDENT_PERFORMANCE, PERMISSION_LEVELS.READ)
  @Get()
  list(@Param('studentId') studentId: string): Promise<PerformanceShares> {
    return this.shares.list(studentId);
  }

  @RequiresFeature(FEATURE_KEYS.STUDENT_PERFORMANCE, PERMISSION_LEVELS.WRITE)
  @Post()
  create(
    @Param('studentId') studentId: string,
    @Body(new ZodBody(createPerformanceShareSchema)) body: CreatePerformanceShareInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PerformanceShare> {
    return this.shares.create(studentId, body, user.id);
  }

  /** For when a link must come down and the student cannot be reached. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_PERFORMANCE, PERMISSION_LEVELS.WRITE)
  @Post(':id/revoke')
  revoke(
    @Param('studentId') studentId: string,
    @Param('id') id: string,
  ): Promise<PerformanceShare> {
    return this.shares.revoke(studentId, id);
  }
}
