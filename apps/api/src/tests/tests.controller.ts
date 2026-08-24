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
  assemblePaperSchema,
  AUDIT_ACTION,
  AUDIT_FEATURE,
  createTestSchema,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  setTestSeriesSchema,
  setTestStatusSchema,
  testListQuerySchema,
  updateTestSchema,
  type AssemblePaperBody,
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
  type TestStatus,
  type UpdateTestBody,
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

  /** Idempotent: a second finalize reports the first one's outcome rather than freezing twice. */
  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post(':id/finalize')
  @HttpCode(HttpStatus.OK)
  finalize(@Param('id') id: string): Promise<FinalizeResult> {
    return this.finalizer.finalize(id);
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
