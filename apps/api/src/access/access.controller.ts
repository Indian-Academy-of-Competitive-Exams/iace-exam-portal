import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ActorTypes,
  AUDIT_ACTION,
  AUDIT_FEATURE,
  createProgramSchema,
  createTestSeriesSchema,
  decideUnlockRequestSchema,
  FEATURE_KEYS,
  grantSeriesSchema,
  PERMISSION_LEVELS,
  programListQuerySchema,
  testSeriesListQuerySchema,
  unlockRequestListQuerySchema,
  updateBranchTestConfigSchema,
  updateProgramSchema,
  updateTestSeriesSchema,
  type BranchTestConfigRow,
  type CreateProgramBody,
  type CreateTestSeriesBody,
  type DecideUnlockRequestBody,
  type GrantSeriesBody,
  type Paginated,
  type Program,
  type ProgramListQuery,
  type SeriesUnlockRequestRow,
  type StudentGrantRow,
  type StudentSeriesAccess,
  type TestSeriesListQuery,
  type TestSeriesSummary,
  type UnlockRequestListQuery,
  type UpdateBranchTestConfigBody,
  type UpdateProgramBody,
  type UpdateTestSeriesBody,
} from '@iace/contracts';
import {
  Actors,
  branchScopeOf,
  CurrentUser,
  RequiresFeature,
  RequiresSuperAdmin,
  type AuthenticatedUser,
} from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { ProgramsService } from './programs.service';
import { TestSeriesService } from './test-series.service';
import { StudentGrantsService } from './student-grants.service';
import { UnlocksService } from './unlocks.service';

/** The coaching variants a student can be a candidate for. Super admin writes, everyone reads. */
@Controller('admin/programs')
@Actors(ActorTypes.ADMIN)
export class ProgramsController {
  constructor(private readonly programs: ProgramsService) {}

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Query(new ZodQuery(programListQuerySchema)) query: ProgramListQuery,
  ): Promise<Paginated<Program>> {
    return this.programs.list(query);
  }

  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.CREATE)
  @Post()
  @RequiresSuperAdmin()
  create(@Body(new ZodBody(createProgramSchema)) body: CreateProgramBody): Promise<Program> {
    return this.programs.create(body);
  }

  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.UPDATE)
  @Patch(':id')
  @RequiresSuperAdmin()
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateProgramSchema)) body: UpdateProgramBody,
  ): Promise<Program> {
    return this.programs.update(id, body);
  }

  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.DELETE)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequiresSuperAdmin()
  remove(@Param('id') id: string): Promise<void> {
    return this.programs.remove(id);
  }
}

/** Series are the unit of offering, so they are gated on TEST_MANAGEMENT rather than students. */
@Controller('admin/test-series')
@Actors(ActorTypes.ADMIN)
export class TestSeriesController {
  constructor(private readonly series: TestSeriesService) {}

  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Query(new ZodQuery(testSeriesListQuerySchema)) query: TestSeriesListQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<TestSeriesSummary>> {
    return this.series.list(query, branchScopeOf(user));
  }

  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get(':id')
  detail(@Param('id') id: string): Promise<TestSeriesSummary> {
    return this.series.detail(id);
  }

  /** Creating one gives every branch a row, switched off — see the fan-out. */
  @Audit(AUDIT_FEATURE.TEST_SERIES, AUDIT_ACTION.CREATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post()
  create(
    @Body(new ZodBody(createTestSeriesSchema)) body: CreateTestSeriesBody,
  ): Promise<TestSeriesSummary> {
    return this.series.create(body);
  }

  @Audit(AUDIT_FEATURE.TEST_SERIES, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateTestSeriesSchema)) body: UpdateTestSeriesBody,
  ): Promise<TestSeriesSummary> {
    return this.series.update(id, body);
  }

  @Audit(AUDIT_FEATURE.TEST_SERIES, AUDIT_ACTION.DELETE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string): Promise<void> {
    return this.series.remove(id);
  }

  @RequiresFeature(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get(':id/branches')
  branches(@Param('id') id: string): Promise<BranchTestConfigRow[]> {
    return this.series.branchConfigs(id);
  }

  /** The same switch, thrown for every branch at once. */
  @Audit(AUDIT_FEATURE.TEST_SERIES, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id/branches')
  updateEveryBranch(
    @Param('id') id: string,
    @Body(new ZodBody(updateBranchTestConfigSchema)) body: UpdateBranchTestConfigBody,
  ): Promise<BranchTestConfigRow[]> {
    return this.series.updateEveryBranchConfig(id, body);
  }

  /** Which branches run it, and when. A separate key: scheduling is its own job. */
  @Audit(AUDIT_FEATURE.TEST_SERIES, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id/branches/:branchId')
  updateBranch(
    @Param('id') id: string,
    @Param('branchId') branchId: string,
    @Body(new ZodBody(updateBranchTestConfigSchema)) body: UpdateBranchTestConfigBody,
  ): Promise<BranchTestConfigRow> {
    return this.series.updateBranchConfig(id, branchId, body);
  }
}

/** The unlock queue is about series, so it is gated on TEST_MANAGEMENT — there is no key of its own. */
@Controller('admin/unlock-requests')
@Actors(ActorTypes.ADMIN)
export class UnlockRequestsController {
  constructor(private readonly unlocks: UnlocksService) {}

  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Query(new ZodQuery(unlockRequestListQuerySchema)) query: UnlockRequestListQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<SeriesUnlockRequestRow>> {
    return this.unlocks.listRequests(query, branchScopeOf(user));
  }

  /** Approving opens a locked series, or grants a FREE one they do not reach — see the service. */
  @Audit(AUDIT_FEATURE.TEST_SERIES, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id')
  decide(
    @Param('id') id: string,
    @Body(new ZodBody(decideUnlockRequestSchema)) body: DecideUnlockRequestBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SeriesUnlockRequestRow> {
    return this.unlocks.decide(id, user.id, body.status, branchScopeOf(user));
  }
}

/** A grant is filed against the STUDENT, which is who you are looking at when you make one. */
@Controller('admin/students/:studentId/grants')
@Actors(ActorTypes.ADMIN)
export class StudentGrantsController {
  constructor(private readonly grants: StudentGrantsService) {}

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Param('studentId') studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StudentGrantRow[]> {
    return this.grants.list(studentId, branchScopeOf(user));
  }

  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post()
  grant(
    @Param('studentId') studentId: string,
    @Body(new ZodBody(grantSeriesSchema)) body: GrantSeriesBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StudentGrantRow[]> {
    return this.grants.grant(studentId, body, user.id, branchScopeOf(user));
  }

  @Audit(AUDIT_FEATURE.STUDENT, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Delete(':testSeriesId')
  @HttpCode(HttpStatus.OK)
  revoke(
    @Param('studentId') studentId: string,
    @Param('testSeriesId') testSeriesId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.grants.revoke(studentId, testSeriesId, branchScopeOf(user));
  }
}

/** What a student reaches and why — a grant is one of the three answers, not the whole of it. */
@Controller('admin/students/:studentId/series')
@Actors(ActorTypes.ADMIN)
export class StudentSeriesController {
  constructor(private readonly grants: StudentGrantsService) {}

  @RequiresFeature(FEATURE_KEYS.STUDENT_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Param('studentId') studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StudentSeriesAccess[]> {
    return this.grants.reachedSeries(studentId, branchScopeOf(user));
  }
}
