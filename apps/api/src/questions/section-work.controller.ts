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
} from '@nestjs/common';
import {
  ActorTypes,
  AUDIT_ACTION,
  AUDIT_FEATURE,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  questionDraftSchema,
  sendBackSchema,
  type QuestionDetail,
  type QuestionDraft,
  type QuestionOnOtherTest,
  type SectionWork,
  type SendBackBody,
} from '@iace/contracts';
import {
  Actors,
  CurrentUser,
  RequiresAnyFeature,
  type AuthenticatedUser,
} from '../common/security';
import { ZodBody } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { SectionWorkService, type SectionViewer } from './section-work.service';

/** The guard only says they work on sections; the service says whether this one is theirs. */
const SECTION_KEYS = [
  FEATURE_KEYS.QUESTION_AUTHORING,
  FEATURE_KEYS.QUESTION_PROOFREAD,
  FEATURE_KEYS.TEST_MANAGEMENT,
] as const;

const viewerOf = (user: AuthenticatedUser): SectionViewer => ({
  id: user.id,
  isSuperAdmin: user.isSuperAdmin,
  permissions: user.permissions,
});

/** One section of one test, for its typist, its proof-reader and the test's owner alike. */
@Controller('admin/sections/:testId/:sectionId')
@Actors(ActorTypes.ADMIN)
export class SectionWorkController {
  constructor(private readonly work: SectionWorkService) {}

  @RequiresAnyFeature(SECTION_KEYS, PERMISSION_LEVELS.READ)
  @Get()
  one(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SectionWork> {
    return this.work.one({ testId, baseConfigSectionId: sectionId }, viewerOf(user));
  }

  @RequiresAnyFeature(SECTION_KEYS, PERMISSION_LEVELS.READ)
  @Get('questions/:questionId')
  question(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
    @Param('questionId') questionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionDetail> {
    return this.work.question(
      { testId, baseConfigSectionId: sectionId },
      questionId,
      viewerOf(user),
    );
  }

  @Audit(AUDIT_FEATURE.QUESTION, AUDIT_ACTION.UPDATE)
  @RequiresAnyFeature(SECTION_KEYS, PERMISSION_LEVELS.WRITE)
  @Patch('questions/:questionId')
  edit(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
    @Param('questionId') questionId: string,
    @Body(new ZodBody(questionDraftSchema)) body: QuestionDraft,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionDetail> {
    return this.work.edit(
      { testId, baseConfigSectionId: sectionId },
      questionId,
      body,
      viewerOf(user),
    );
  }

  @RequiresAnyFeature(SECTION_KEYS, PERMISSION_LEVELS.READ)
  @Get('questions/:questionId/other-tests')
  otherTests(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
    @Param('questionId') questionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionOnOtherTest[]> {
    return this.work.otherTests(
      { testId, baseConfigSectionId: sectionId },
      questionId,
      viewerOf(user),
    );
  }

  @RequiresAnyFeature(SECTION_KEYS, PERMISSION_LEVELS.WRITE)
  @HttpCode(HttpStatus.OK)
  @Post('questions/:questionId/check')
  check(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
    @Param('questionId') questionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SectionWork> {
    return this.work.check({ testId, baseConfigSectionId: sectionId }, questionId, viewerOf(user));
  }

  @RequiresAnyFeature(SECTION_KEYS, PERMISSION_LEVELS.WRITE)
  @HttpCode(HttpStatus.OK)
  @Delete('questions/:questionId/check')
  uncheck(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
    @Param('questionId') questionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SectionWork> {
    return this.work.uncheck(
      { testId, baseConfigSectionId: sectionId },
      questionId,
      viewerOf(user),
    );
  }

  @RequiresAnyFeature(SECTION_KEYS, PERMISSION_LEVELS.WRITE)
  @HttpCode(HttpStatus.OK)
  @Post('questions/:questionId/send-back')
  sendBack(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
    @Param('questionId') questionId: string,
    @Body(new ZodBody(sendBackSchema)) body: SendBackBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SectionWork> {
    return this.work.sendBack(
      { testId, baseConfigSectionId: sectionId },
      questionId,
      body,
      viewerOf(user),
    );
  }

  @RequiresAnyFeature(SECTION_KEYS, PERMISSION_LEVELS.WRITE)
  @HttpCode(HttpStatus.OK)
  @Post('questions/:questionId/fixed')
  fixed(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
    @Param('questionId') questionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SectionWork> {
    return this.work.fixed({ testId, baseConfigSectionId: sectionId }, questionId, viewerOf(user));
  }
}
