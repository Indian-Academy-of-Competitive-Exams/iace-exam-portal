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
  FEATURE_KEYS,
  grantSeriesSchema,
  PERMISSION_LEVELS,
  programListQuerySchema,
  branchSeriesListQuerySchema,
  setBranchSeriesSchema,
  testSeriesListQuerySchema,
  updateBranchTestConfigSchema,
  updateProgramSchema,
  updateTestSeriesSchema,
  type BranchTestConfigRow,
  type CreateProgramBody,
  type CreateTestSeriesBody,
  type GrantSeriesBody,
  type Paginated,
  type Program,
  type ProgramListQuery,
  type StudentGrantRow,
  type StudentSeriesAccess,
  type BranchSeriesListQuery,
  type BranchSeriesRow,
  type SetBranchSeriesBody,
  type TestSeriesListQuery,
  type TestSeriesSummary,
  type UpdateBranchTestConfigBody,
  type UpdateProgramBody,
  type UpdateTestSeriesBody,
} from '@iace/contracts';
import {
  Actors,
  assertBranchInScope,
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
  branches(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BranchTestConfigRow[]> {
    return this.series.branchConfigs(id, branchScopeOf(user));
  }

  /** The same switch, thrown for every branch at once. */
  @Audit(AUDIT_FEATURE.TEST_SERIES, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id/branches')
  updateEveryBranch(
    @Param('id') id: string,
    @Body(new ZodBody(updateBranchTestConfigSchema)) body: UpdateBranchTestConfigBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BranchTestConfigRow[]> {
    return this.series.updateEveryBranchConfig(id, body, branchScopeOf(user));
  }

  /** Which branches run it, and when. A separate key: scheduling is its own job. */
  @Audit(AUDIT_FEATURE.TEST_SERIES, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id/branches/:branchId')
  updateBranch(
    @Param('id') id: string,
    @Param('branchId') branchId: string,
    @Body(new ZodBody(updateBranchTestConfigSchema)) body: UpdateBranchTestConfigBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BranchTestConfigRow> {
    return this.series.updateBranchConfig(id, branchId, body, branchScopeOf(user));
  }
}

/** One branch's series, from the branch's side. The rows are `access`'s, so the controller is too. */
@Controller('admin/branches/:branchId/test-series')
@Actors(ActorTypes.ADMIN)
export class BranchSeriesController {
  constructor(private readonly series: TestSeriesService) {}

  @RequiresFeature(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Param('branchId') branchId: string,
    @Query(new ZodQuery(branchSeriesListQuerySchema)) query: BranchSeriesListQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<BranchSeriesRow>> {
    assertBranchInScope(branchScopeOf(user), branchId);
    return this.series.seriesForBranch(branchId, query);
  }

  @Audit(AUDIT_FEATURE.BRANCH_TEST_CONFIG, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch()
  set(
    @Param('branchId') branchId: string,
    @Body(new ZodBody(setBranchSeriesSchema)) body: SetBranchSeriesBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ changed: number }> {
    assertBranchInScope(branchScopeOf(user), branchId);
    return this.series.setSeriesForBranch(branchId, body).then((changed) => ({ changed }));
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
