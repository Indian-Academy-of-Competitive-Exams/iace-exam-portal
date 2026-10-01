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
  AUDIT_ACTION,
  AUDIT_FEATURE,
  createTestSchema,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  setTestSeriesSchema,
  saveOfferingSchema,
  testListQuerySchema,
  updateTestSchema,
  type AddPaperQuestionBody,
  type CreateTestBody,
  type Paginated,
  type SetTestSeriesBody,
  type Test,
  type TestDetail,
  type TestListQuery,
  type TestPaper,
  type TestSeriesLink,
  type SeriesTestRow,
  type SaveOfferingBody,
  type TestOffering,
  type UpdateTestBody,
  setPaperQuestionStatusSchema,
  removePaperQuestionsSchema,
  type SetPaperQuestionStatusBody,
  type RemovePaperQuestionsQuery,
  typistDoneSchema,
  type SectionWork,
  type TypistDoneBody,
} from '@iace/contracts';
import { Actors, CurrentUser, RequiresFeature, type AuthenticatedUser } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { TestsService } from './tests.service';
import { PaperService } from './paper.service';
import { OfferingService } from './offering.service';
import { SectionWorkService } from '../questions';

/** The tests built from a stage's blueprints. Gated on TEST_MANAGEMENT, like the configs are. */
@Controller('admin/tests')
@Actors(ActorTypes.ADMIN)
export class TestsController {
  constructor(
    private readonly tests: TestsService,
    private readonly paper: PaperService,
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
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TestDetail> {
    return this.tests.update(id, body, user);
  }

  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get(':id/paper')
  readPaper(@Param('id') id: string): Promise<TestPaper> {
    return this.paper.read(id);
  }

  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post(':id/paper/questions')
  @HttpCode(HttpStatus.OK)
  addPaperQuestions(
    @Param('id') id: string,
    @Body(new ZodBody(addPaperQuestionSchema)) body: AddPaperQuestionBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TestPaper> {
    return this.paper.addQuestions(id, body, user);
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
    return this.paper.setQuestionStatus(id, rowId, body);
  }

  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Delete(':id/paper/questions')
  removePaperQuestions(
    @Param('id') id: string,
    @Query(new ZodQuery(removePaperQuestionsSchema)) query: RemovePaperQuestionsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TestPaper> {
    return this.paper.removeQuestions(id, query.rowIds ?? [], user);
  }

  /** Draws what one section still lacks. It only ever adds: a hand-picked row is never displaced. */
  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post(':id/paper/sections/:sectionId/fill')
  @HttpCode(HttpStatus.OK)
  fillPaperSection(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TestPaper> {
    return this.paper.fillSection(id, sectionId, user);
  }

  /** A picked section, full, handed to its proof-reader; a typed one is handed at its typist's Done. */
  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post(':id/paper/sections/:sectionId/hand-over')
  @HttpCode(HttpStatus.OK)
  handOverSection(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TestPaper> {
    return this.paper.handOver(id, sectionId, user);
  }

  /** The Offer step's one write: the opening, the program openings and whether students get it. */
  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Put(':id/offering')
  saveOffering(
    @Param('id') id: string,
    @Body(new ZodBody(saveOfferingSchema)) body: SaveOfferingBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TestOffering> {
    return this.offering.saveOffering(id, body, user.isSuperAdmin);
  }

  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post(':id/series')
  @HttpCode(HttpStatus.OK)
  moveToSeries(
    @Param('id') id: string,
    @Body(new ZodBody(setTestSeriesSchema)) body: SetTestSeriesBody,
  ): Promise<TestSeriesLink> {
    return this.offering.moveToSeries(id, body);
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
}

/** A typist's Done lands here because its effect is the paper, which this module owns. */
@Controller('admin/sections/:testId/:sectionId')
@Actors(ActorTypes.ADMIN)
export class TypistDoneController {
  constructor(
    private readonly paper: PaperService,
    private readonly work: SectionWorkService,
  ) {}

  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.QUESTION_AUTHORING, PERMISSION_LEVELS.WRITE)
  @Post('done')
  @HttpCode(HttpStatus.OK)
  async done(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
    @Body(new ZodBody(typistDoneSchema)) body: TypistDoneBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SectionWork> {
    const pair = { testId, baseConfigSectionId: sectionId };
    const typing = await this.work.actingTypist(pair, user);
    await this.paper.typistDone(typing.id, body);
    return this.work.one(pair, user);
  }
}
