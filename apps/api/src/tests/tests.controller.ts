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
  replacePaperQuestionSchema,
  AUDIT_ACTION,
  AUDIT_FEATURE,
  createTestSchema,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  readPaperQuerySchema,
  setTestSeriesSchema,
  setProgramUnlockSchema,
  setSeriesTestUnlockSchema,
  setTestStatusSchema,
  testListQuerySchema,
  testScheduleSchema,
  updateTestSchema,
  type AddPaperQuestionBody,
  type ReplacePaperQuestionBody,
  type CreateTestBody,
  type FinalizeResult,
  type Paginated,
  type ReadPaperQuery,
  type SetTestSeriesBody,
  type SetTestStatusBody,
  type Test,
  type TestDetail,
  type TestListQuery,
  type TestPaper,
  type TestSeriesLink,
  type OfferResult,
  type SeriesTestRow,
  type SetProgramUnlockBody,
  type SetSeriesTestUnlockBody,
  type TestProgramUnlock,
  type TestSchedule,
  type TestStatus,
  type UpdateTestBody,
  setPaperQuestionStatusSchema,
  removePaperQuestionsSchema,
  type SetPaperQuestionStatusBody,
  type RemovePaperQuestionsQuery,
} from '@iace/contracts';
import { Actors, CurrentUser, RequiresFeature, type AuthenticatedUser } from '../common/security';
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
  readPaper(
    @Param('id') id: string,
    @Query(new ZodQuery(readPaperQuerySchema)) query: ReadPaperQuery,
  ): Promise<TestPaper> {
    return this.paper.read(id, query.variant);
  }

  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post(':id/paper/questions')
  @HttpCode(HttpStatus.OK)
  addPaperQuestions(
    @Param('id') id: string,
    @Body(new ZodBody(addPaperQuestionSchema)) body: AddPaperQuestionBody,
  ): Promise<TestPaper> {
    return this.paper.addQuestions(id, body);
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
  @Delete(':id/paper/questions')
  removePaperQuestions(
    @Param('id') id: string,
    @Query(new ZodQuery(removePaperQuestionsSchema)) query: RemovePaperQuestionsQuery,
  ): Promise<TestPaper> {
    return this.paper.removeQuestions(id, query.rowIds ?? []);
  }

  /** Draws what one section still lacks. It only ever adds: a hand-picked row is never displaced. */
  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post(':id/paper/sections/:sectionId/fill')
  @HttpCode(HttpStatus.OK)
  fillPaperSection(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
  ): Promise<TestPaper> {
    return this.paper.fillSection(id, sectionId);
  }

  /** Idempotent: a second finalize reports the first one's outcome rather than freezing twice. */
  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post(':id/finalize')
  @HttpCode(HttpStatus.OK)
  finalize(@Param('id') id: string): Promise<FinalizeResult> {
    return this.finalizer.finalize(id);
  }

  /** The test's own late entry and extra time, on the key that owns every other field of it. */
  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Put(':id/schedule')
  setSchedule(
    @Param('id') id: string,
    @Body(new ZodBody(testScheduleSchema)) body: TestSchedule,
  ): Promise<TestSchedule> {
    return this.offering.setSchedule(id, body);
  }

  /** A program opens a test EARLIER; entry still closes when it closes for everyone. */
  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Put(':id/program-unlocks/:programCode')
  setProgramUnlock(
    @Param('id') id: string,
    @Param('programCode') programCode: string,
    @Body(new ZodBody(setProgramUnlockSchema)) body: SetProgramUnlockBody,
  ): Promise<TestProgramUnlock[]> {
    return this.offering.setProgramUnlock(id, programCode, body);
  }

  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Delete(':id/program-unlocks/:programCode')
  @HttpCode(HttpStatus.OK)
  clearProgramUnlock(
    @Param('id') id: string,
    @Param('programCode') programCode: string,
  ): Promise<TestProgramUnlock[]> {
    return this.offering.clearProgramUnlock(id, programCode);
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
  series(@Param('id') id: string): Promise<TestSeriesLink | null> {
    return this.offering.series(id);
  }

  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post(':id/series')
  @HttpCode(HttpStatus.OK)
  moveToSeries(
    @Param('id') id: string,
    @Body(new ZodBody(setTestSeriesSchema)) body: SetTestSeriesBody,
  ): Promise<TestSeriesLink | null> {
    return this.offering.moveToSeries(id, body);
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

/** The membership from the SERIES' side. It lives here because the tests module owns `Test`. */
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
}
