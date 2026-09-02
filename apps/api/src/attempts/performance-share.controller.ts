/**
 * Three doors onto one service. Only the FIRST is @Public(), and it is read-only and addressed
 * by a token nobody can guess — the mirror image of leaderboard.controller.ts, which asserts it
 * is not public for the same reason. Minting and revoking both require a signed-in identity.
 */
import { Body, Controller, Get, Header, Param, Post } from '@nestjs/common';
import {
  ActorTypes,
  AUDIT_ACTION,
  AUDIT_FEATURE,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  createPerformanceShareSchema,
  satisfiesLevel,
  type CreatePerformanceShareInput,
  type PerformanceShare,
  type PerformanceShares,
  type SharedReport,
} from '@iace/contracts';
import {
  Actors,
  branchScopeOf,
  CurrentUser,
  EVERY_BRANCH,
  Public,
  RequiresFeature,
  type AuthenticatedUser,
} from '../common/security';
import { ShareRateLimit } from '../common/throttling';
import { Audit } from '../audit';
import { ZodBody } from '../common/zod-validation.pipe';
import { PerformanceShareService } from './performance-share.service';

/** A READ-only admin may see that a link exists; being handed a working one is a WRITE act. */
const holdsWrite = (user: AuthenticatedUser): boolean =>
  user.isSuperAdmin ||
  satisfiesLevel(user.permissions[FEATURE_KEYS.STUDENT_PERFORMANCE], PERMISSION_LEVELS.WRITE);

@Controller('public/reports')
export class PublicReportController {
  constructor(private readonly shares: PerformanceShareService) {}

  /** The only unauthenticated route to student data: one student's own curated report. */
  @Public()
  @ShareRateLimit()
  // No freshness directive is heuristically cacheable, so a proxy would outlive a revocation.
  @Header('Cache-Control', 'no-store')
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
    return this.shares.list(user.id, EVERY_BRANCH, true);
  }

  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.CREATE)
  @Post()
  create(
    @Body(new ZodBody(createPerformanceShareSchema)) body: CreatePerformanceShareInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PerformanceShare> {
    return this.shares.create(user.id, body, null, EVERY_BRANCH);
  }

  /** A student can always kill a link to their own data. */
  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.UPDATE)
  @Post(':id/revoke')
  revoke(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PerformanceShare> {
    return this.shares.revoke(user.id, id, EVERY_BRANCH);
  }
}

@Controller('admin/students/:studentId/performance/shares')
@Actors(ActorTypes.ADMIN)
export class AdminPerformanceShareController {
  constructor(private readonly shares: PerformanceShareService) {}

  @RequiresFeature(FEATURE_KEYS.STUDENT_PERFORMANCE, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Param('studentId') studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PerformanceShares> {
    return this.shares.list(studentId, branchScopeOf(user), holdsWrite(user));
  }

  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.CREATE)
  @RequiresFeature(FEATURE_KEYS.STUDENT_PERFORMANCE, PERMISSION_LEVELS.WRITE)
  @Post()
  create(
    @Param('studentId') studentId: string,
    @Body(new ZodBody(createPerformanceShareSchema)) body: CreatePerformanceShareInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PerformanceShare> {
    return this.shares.create(studentId, body, user.id, branchScopeOf(user));
  }

  /** For when a link must come down and the student cannot be reached. */
  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.STUDENT_PERFORMANCE, PERMISSION_LEVELS.WRITE)
  @Post(':id/revoke')
  revoke(
    @Param('studentId') studentId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PerformanceShare> {
    return this.shares.revoke(studentId, id, branchScopeOf(user));
  }
}
