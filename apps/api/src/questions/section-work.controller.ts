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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ActorTypes,
  AUDIT_ACTION,
  AUDIT_FEATURE,
  FEATURE_KEYS,
  IMPORT_FILE_FIELD,
  PERMISSION_LEVELS,
  questionDraftSchema,
  questionImportCommitSchema,
  sendBackSchema,
  type QuestionDetail,
  type QuestionDraft,
  type QuestionImportCommitBody,
  type QuestionImportPlan,
  type QuestionImportResult,
  type QuestionOnOtherTest,
  type SectionWork,
  type SendBackBody,
} from '@iace/contracts';
import {
  Actors,
  CurrentUser,
  RequiresAnyFeature,
  RequiresFeature,
  type AuthenticatedUser,
} from '../common/security';
import { requireFile, type UploadedSheet } from '../common/importing/upload';
import { ZodBody } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { SectionWorkService } from './section-work.service';

/** The guard only says they work on sections; the service says whether this one is theirs. */
const SECTION_KEYS = [
  FEATURE_KEYS.QUESTION_AUTHORING,
  FEATURE_KEYS.QUESTION_PROOFREAD,
  FEATURE_KEYS.TEST_MANAGEMENT,
] as const;

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
    return this.work.one({ testId, baseConfigSectionId: sectionId }, user);
  }

  /** The typist's key, as on every typing write; the service says whose typing job it lands under. */
  @Audit(AUDIT_FEATURE.QUESTION, AUDIT_ACTION.CREATE)
  @RequiresFeature(FEATURE_KEYS.QUESTION_AUTHORING, PERMISSION_LEVELS.WRITE)
  @Post('questions')
  create(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
    @Body(new ZodBody(questionDraftSchema)) body: QuestionDraft,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionDetail> {
    return this.work.create({ testId, baseConfigSectionId: sectionId }, body, user);
  }

  /** The bank's sheet, landing in the section rather than loose. */
  @RequiresFeature(FEATURE_KEYS.QUESTION_AUTHORING, PERMISSION_LEVELS.WRITE)
  @HttpCode(HttpStatus.OK)
  @Post('import/preview')
  @UseInterceptors(FileInterceptor(IMPORT_FILE_FIELD))
  previewImport(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: UploadedSheet,
  ): Promise<QuestionImportPlan> {
    const pair = { testId, baseConfigSectionId: sectionId };
    return this.work.previewImport(pair, requireFile(file), user);
  }

  @Audit(AUDIT_FEATURE.QUESTION, AUDIT_ACTION.CREATE)
  @RequiresFeature(FEATURE_KEYS.QUESTION_AUTHORING, PERMISSION_LEVELS.WRITE)
  @HttpCode(HttpStatus.OK)
  @Post('import/commit')
  commitImport(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
    @Body(new ZodBody(questionImportCommitSchema)) body: QuestionImportCommitBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionImportResult> {
    const pair = { testId, baseConfigSectionId: sectionId };
    return this.work.commitImport(pair, body.importLogId, user);
  }

  /** A reader's "I've read this". A typist's hand-over is Done, which chooses the paper. */
  @RequiresFeature(FEATURE_KEYS.QUESTION_PROOFREAD, PERMISSION_LEVELS.WRITE)
  @HttpCode(HttpStatus.OK)
  @Post('release')
  release(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SectionWork> {
    return this.work.release({ testId, baseConfigSectionId: sectionId }, user);
  }

  @RequiresAnyFeature(SECTION_KEYS, PERMISSION_LEVELS.READ)
  @Get('questions/:questionId')
  question(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
    @Param('questionId') questionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionDetail> {
    return this.work.question({ testId, baseConfigSectionId: sectionId }, questionId, user);
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
    return this.work.edit({ testId, baseConfigSectionId: sectionId }, questionId, body, user);
  }

  @Audit(AUDIT_FEATURE.QUESTION, AUDIT_ACTION.DELETE)
  @RequiresAnyFeature(SECTION_KEYS, PERMISSION_LEVELS.WRITE)
  @HttpCode(HttpStatus.OK)
  @Delete('questions/:questionId')
  remove(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
    @Param('questionId') questionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.work.remove({ testId, baseConfigSectionId: sectionId }, questionId, user);
  }

  @RequiresAnyFeature(SECTION_KEYS, PERMISSION_LEVELS.READ)
  @Get('questions/:questionId/other-tests')
  otherTests(
    @Param('testId') testId: string,
    @Param('sectionId') sectionId: string,
    @Param('questionId') questionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionOnOtherTest[]> {
    return this.work.otherTests({ testId, baseConfigSectionId: sectionId }, questionId, user);
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
    return this.work.check({ testId, baseConfigSectionId: sectionId }, questionId, user);
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
    return this.work.uncheck({ testId, baseConfigSectionId: sectionId }, questionId, user);
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
    return this.work.sendBack({ testId, baseConfigSectionId: sectionId }, questionId, body, user);
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
    return this.work.fixed({ testId, baseConfigSectionId: sectionId }, questionId, user);
  }
}
