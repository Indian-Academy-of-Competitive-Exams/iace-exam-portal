/**
 * The two ways into one dashboard. The student's path takes its subject from the token and cannot
 * name anybody; the admin's names one in the path and pays for it with STUDENT_PERFORMANCE.
 */
import { Controller, Get, Param } from '@nestjs/common';
import { ActorTypes, FEATURE_KEYS, PERMISSION_LEVELS, type StudentOverview } from '@iace/contracts';
import {
  Actors,
  branchScopeOf,
  CurrentUser,
  RequiresFeature,
  type AuthenticatedUser,
} from '../common/security';
import { StudentOverviewService } from './overview.service';

@Controller('me/overview')
@Actors(ActorTypes.STUDENT)
export class MeOverviewController {
  constructor(private readonly overview: StudentOverviewService) {}

  /** Their whole career as the rollup has folded it — never anybody else's. */
  @Get()
  read(@CurrentUser() user: AuthenticatedUser): Promise<StudentOverview> {
    return this.overview.overview(user.id);
  }
}

@Controller('admin/students/:studentId/overview')
@Actors(ActorTypes.ADMIN)
export class AdminOverviewController {
  constructor(private readonly overview: StudentOverviewService) {}

  /** The same payload the student reads, for any student in the admin's own branches. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_PERFORMANCE, PERMISSION_LEVELS.READ)
  @Get()
  read(
    @Param('studentId') studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StudentOverview> {
    return this.overview.forStudent(studentId, branchScopeOf(user));
  }
}
