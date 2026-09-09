/**
 * Live operations. READ watches; WRITE reaches into a real student's sitting, which is why the
 * two levels are split and why every write route is audited against the student it happened to.
 */
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ActorTypes,
  AUDIT_ACTION,
  AUDIT_FEATURE,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  extendAttemptSchema,
  forceSubmitAttemptSchema,
  liveOpsTestQuerySchema,
  resetAttemptSchema,
  voidAttemptSchema,
  type ExtendAttemptBody,
  type ForceSubmitAttemptBody,
  type LiveOpsBoard,
  type LiveOpsTest,
  type LiveOpsTestQuery,
  type Paginated,
  type ResetAttemptBody,
  type ResolvedAttempt,
  type VoidAttemptBody,
} from '@iace/contracts';
import { Actors, CurrentUser, RequiresFeature, type AuthenticatedUser } from '../common/security';
import { Audit } from '../audit';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { AttemptResolutionService } from './attempt-resolution.service';
import { LiveOpsService } from './live-ops.service';

@Controller('admin/live-ops')
@Actors(ActorTypes.ADMIN)
export class AdminLiveOpsController {
  constructor(
    private readonly liveOps: LiveOpsService,
    private readonly resolution: AttemptResolutionService,
  ) {}

  @RequiresFeature(FEATURE_KEYS.TEST_OPERATIONS, PERMISSION_LEVELS.READ)
  @Get('tests')
  tests(
    @Query(new ZodQuery(liveOpsTestQuerySchema)) query: LiveOpsTestQuery,
  ): Promise<Paginated<LiveOpsTest>> {
    return this.liveOps.tests(query);
  }

  @RequiresFeature(FEATURE_KEYS.TEST_OPERATIONS, PERMISSION_LEVELS.READ)
  @Get('tests/:testId')
  board(@Param('testId') testId: string): Promise<LiveOpsBoard> {
    return this.liveOps.board(testId);
  }

  @RequiresFeature(FEATURE_KEYS.TEST_OPERATIONS, PERMISSION_LEVELS.WRITE)
  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.UPDATE)
  @Post('attempts/:attemptId/force-submit')
  forceSubmit(
    @Param('attemptId') attemptId: string,
    @Body(new ZodBody(forceSubmitAttemptSchema)) body: ForceSubmitAttemptBody,
  ): Promise<ResolvedAttempt> {
    return this.resolution.forceSubmit(attemptId, body);
  }

  @RequiresFeature(FEATURE_KEYS.TEST_OPERATIONS, PERMISSION_LEVELS.WRITE)
  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.UPDATE)
  @Post('attempts/:attemptId/extend')
  extend(
    @Param('attemptId') attemptId: string,
    @Body(new ZodBody(extendAttemptSchema)) body: ExtendAttemptBody,
  ): Promise<ResolvedAttempt> {
    return this.resolution.extend(attemptId, body);
  }

  @RequiresFeature(FEATURE_KEYS.TEST_OPERATIONS, PERMISSION_LEVELS.WRITE)
  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.UPDATE)
  @Post('attempts/:attemptId/reset')
  reset(
    @Param('attemptId') attemptId: string,
    @Body(new ZodBody(resetAttemptSchema)) body: ResetAttemptBody,
  ): Promise<ResolvedAttempt> {
    return this.resolution.reset(attemptId, body);
  }

  /** DEACTIVATE, not DELETE: a voided sitting is stood down and kept, and the log has to say so. */
  @RequiresFeature(FEATURE_KEYS.TEST_OPERATIONS, PERMISSION_LEVELS.WRITE)
  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.DEACTIVATE)
  @Post('attempts/:attemptId/void')
  voidSitting(
    @Param('attemptId') attemptId: string,
    @Body(new ZodBody(voidAttemptSchema)) body: VoidAttemptBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResolvedAttempt> {
    return this.resolution.void(attemptId, body, user.id);
  }
}
