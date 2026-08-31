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
  Put,
  Query,
} from '@nestjs/common';
import {
  ActorTypes,
  addPaperQuestionSchema,
  assemblePaperSchema,
  replacePaperQuestionSchema,
  AUDIT_ACTION,
  AUDIT_FEATURE,
  createTestSchema,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  setTestSeriesSchema,
  branchTestListQuerySchema,
  setBranchTestScheduleSchema,
  setBranchTestSchedulesSchema,
  setSeriesTestUnlockSchema,
  setTestStatusSchema,
  testListQuerySchema,
  updateTestSchema,
  type AddPaperQuestionBody,
  type AssemblePaperBody,
  type ReplacePaperQuestionBody,
  type CreateTestBody,
  type FinalizeResult,
  type Paginated,
  type SetTestSeriesBody,
  type SetTestStatusBody,
  type Test,
  type TestDetail,
  type TestListQuery,
  type TestPaper,
  type TestSeriesLink,
  type BranchTestListQuery,
  type BranchTestRow,
  type BranchTestSchedule,
  type BranchTestScheduleRow,
  type OfferResult,
  type SeriesTestRow,
  type SetBranchTestScheduleBody,
  type SetBranchTestSchedulesBody,
  type SetSeriesTestUnlockBody,
  type TestStatus,
  type UpdateTestBody,
  setPaperQuestionStatusSchema,
  type SetPaperQuestionStatusBody,
} from '@iace/contracts';
import {
  Actors,
  assertBranchInScope,
  branchScopeOf,
  CurrentUser,
  RequiresFeature,
  type AuthenticatedUser,
} from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { TestsService } from './tests.service';
import { PaperService } from './paper.service';
import { FinalizeService } from './finalize.service';
import { OfferingService } from './offering.service';

/** The tests built from a stage's blueprints. Gated on TEST_MANAGEMENT, like the configs are. */
@Controller('admin/tests')
@Actors(ActorTypes.ADMIN)
export class TestsController {
  constructor(
    private readonly tests: TestsService,
    private readonly paper: PaperService,
    private readonly finalizer: FinalizeService,
    private readonly offering: OfferingService,
  ) {}

  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(@Query(new ZodQuery(testListQuerySchema)) query: TestListQuery): Promise<Paginated<Test>> {
    return this.tests.list(query);
  }

  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get(':id')
  detail(@Param('id') id: string): Promise<TestDetail> {
    return this.tests.detail(id);
  }

  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.CREATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post()
  create(
    @Body(new ZodBody(createTestSchema)) body: CreateTestBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TestDetail> {
    return this.tests.create(body, user.id);
  }

  /** Refused once the paper is frozen, the title excepted — see `TEST_UNFROZEN_FIELDS`. */
  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodBody(updateTestSchema)) body: UpdateTestBody,
  ): Promise<TestDetail> {
    return this.tests.update(id, body);
  }

  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get(':id/paper')
  readPaper(@Param('id') id: string): Promise<TestPaper> {
    return this.paper.read(id);
  }

  /** Replaces the draft paper: a re-draw is a new paper, not a merge into invisible rows. */
  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post(':id/paper')
  @HttpCode(HttpStatus.OK)
  assemblePaper(
    @Param('id') id: string,
    @Body(new ZodBody(assemblePaperSchema)) body: AssemblePaperBody,
  ): Promise<TestPaper> {
    return this.paper.assemble(id, body);
  }

  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post(':id/paper/questions')
  @HttpCode(HttpStatus.OK)
  addPaperQuestion(
    @Param('id') id: string,
    @Body(new ZodBody(addPaperQuestionSchema)) body: AddPaperQuestionBody,
  ): Promise<TestPaper> {
    return this.paper.addQuestion(id, body);
  }

  /** One row of the paper, so a paper right but for a single question is not redrawn whole. */
  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id/paper/:rowId')
  replacePaperQuestion(
    @Param('id') id: string,
    @Param('rowId') rowId: string,
    @Body(new ZodBody(replacePaperQuestionSchema)) body: ReplacePaperQuestionBody,
  ): Promise<TestPaper> {
    return this.paper.replaceQuestion(id, rowId, body);
  }

  /** The only change a finalized paper allows — and it re-scores every sitting that served it. */
  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id/paper/:rowId/status')
  setPaperQuestionStatus(
    @Param('id') id: string,
    @Param('rowId') rowId: string,
    @Body(new ZodBody(setPaperQuestionStatusSchema)) body: SetPaperQuestionStatusBody,
  ): Promise<TestPaper> {
    return this.paper.setQuestionStatus(id, rowId, body.status);
  }

  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Delete(':id/paper/:rowId')
  removePaperQuestion(@Param('id') id: string, @Param('rowId') rowId: string): Promise<TestPaper> {
    return this.paper.removeQuestion(id, rowId);
  }

  /** Idempotent: a second finalize reports the first one's outcome rather than freezing twice. */
  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post(':id/finalize')
  @HttpCode(HttpStatus.OK)
  finalize(@Param('id') id: string): Promise<FinalizeResult> {
    return this.finalizer.finalize(id);
  }

  @RequiresFeature(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get(':id/branch-timing')
  branchTiming(@Param('id') id: string): Promise<BranchTestScheduleRow[]> {
    return this.offering.branchTiming(id);
  }

  /** Late entry and extra time are a branch's, so they answer to the branch key, not the test's. */
  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post(':id/branch-timing')
  @HttpCode(HttpStatus.OK)
  setBranchTiming(
    @Param('id') id: string,
    @Body(new ZodBody(setBranchTestSchedulesSchema)) body: SetBranchTestSchedulesBody,
  ): Promise<BranchTestScheduleRow[]> {
    return this.offering.setBranchTiming(id, body);
  }

  /** The last step of the builder: freeze the paper and open it, or neither. */
  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post(':id/offer')
  @HttpCode(HttpStatus.OK)
  offer(@Param('id') id: string): Promise<OfferResult> {
    return this.finalizer.offer(id);
  }

  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get(':id/series')
  series(@Param('id') id: string): Promise<TestSeriesLink[]> {
    return this.offering.series(id);
  }

  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post(':id/series')
  @HttpCode(HttpStatus.OK)
  setSeries(
    @Param('id') id: string,
    @Body(new ZodBody(setTestSeriesSchema)) body: SetTestSeriesBody,
  ): Promise<TestSeriesLink[]> {
    return this.offering.setSeries(id, body);
  }

  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id/status')
  setStatus(
    @Param('id') id: string,
    @Body(new ZodBody(setTestStatusSchema)) body: SetTestStatusBody,
  ): Promise<TestStatus> {
    return this.offering.setStatus(id, body.status);
  }

  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.DELETE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string): Promise<void> {
    return this.tests.remove(id);
  }
}

/** The link from the SERIES' side. It lives here because the tests module owns `TestSeriesTest`. */
@Controller('admin/test-series/:seriesId/tests')
@Actors(ActorTypes.ADMIN)
export class SeriesTestsController {
  constructor(private readonly offering: OfferingService) {}

  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(@Param('seriesId') seriesId: string): Promise<SeriesTestRow[]> {
    return this.offering.testsIn(seriesId);
  }

  @Audit(AUDIT_FEATURE.TEST_SERIES, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':testId')
  setUnlock(
    @Param('seriesId') seriesId: string,
    @Param('testId') testId: string,
    @Body(new ZodBody(setSeriesTestUnlockSchema)) body: SetSeriesTestUnlockBody,
  ): Promise<SeriesTestRow[]> {
    return this.offering.setUnlock(seriesId, testId, body);
  }

  @Audit(AUDIT_FEATURE.TEST_SERIES, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Delete(':testId')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param('seriesId') seriesId: string,
    @Param('testId') testId: string,
  ): Promise<SeriesTestRow[]> {
    return this.offering.removeFromSeries(seriesId, testId);
  }
}

/** One branch's tests, from the branch's side. `BranchTestSchedule` is this module's, so this is too. */
@Controller('admin/branches/:branchId/tests')
@Actors(ActorTypes.ADMIN)
export class BranchTestsController {
  constructor(private readonly offering: OfferingService) {}

  @RequiresFeature(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Param('branchId') branchId: string,
    @Query(new ZodQuery(branchTestListQuerySchema)) query: BranchTestListQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<BranchTestRow>> {
    assertBranchInScope(branchScopeOf(user), branchId);
    return this.offering.testsForBranch(branchId, query);
  }

  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.BRANCH_TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Put(':testId/schedule')
  setSchedule(
    @Param('branchId') branchId: string,
    @Param('testId') testId: string,
    @Body(new ZodBody(setBranchTestScheduleSchema)) body: SetBranchTestScheduleBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BranchTestSchedule> {
    assertBranchInScope(branchScopeOf(user), branchId);
    return this.offering.setBranchSchedule(branchId, testId, body);
  }
}
