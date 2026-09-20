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
  authoringCreateSchema,
  authoringDuplicateQuerySchema,
  authoringHistoryQuerySchema,
  questionDraftSchema,
  questionImportCommitSchema,
  type AuthoringCreateInput,
  type AuthoringDuplicate,
  type AuthoringDuplicateQuery,
  type AuthoringHistoryQuery,
  type AuthoringRelease,
  type QuestionImportCommitBody,
  type QuestionImportPlan,
  type QuestionImportResult,
  type AuthoringSaveResult,
  type AuthoringStats,
  type AuthoringTags,
  type Paginated,
  type QuestionDetail,
  type QuestionDraft,
  type QuestionSummary,
} from '@iace/contracts';
import { Actors, CurrentUser, RequiresFeature, type AuthenticatedUser } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { requireFile, type UploadedSheet } from '../common/importing/upload';
import { AuthoringService } from './authoring.service';
import { QuestionImportService } from './question-import.service';

/** Hiding the nav is not what keeps a typist out of the bank — these routes and their scoping are. */
@Controller('admin/authoring')
@Actors(ActorTypes.ADMIN)
@RequiresFeature(FEATURE_KEYS.QUESTION_AUTHORING, PERMISSION_LEVELS.READ)
export class AuthoringController {
  constructor(
    private readonly authoring: AuthoringService,
    private readonly imports: QuestionImportService,
  ) {}

  @Get('tags')
  async tags(@CurrentUser() user: AuthenticatedUser): Promise<AuthoringTags> {
    return { tags: await this.authoring.tags(user.id) };
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthenticatedUser): Promise<AuthoringStats> {
    return this.authoring.stats(user.id);
  }

  @Get('questions')
  history(
    @Query(new ZodQuery(authoringHistoryQuerySchema)) query: AuthoringHistoryQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Paginated<QuestionSummary>> {
    return this.authoring.history(query, user.id);
  }

  @Get('questions/:id')
  detail(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<QuestionDetail> {
    return this.authoring.detail(id, user.id);
  }

  /** No @Audit: asking whether a question exists changes nothing and happens on every keystroke. */
  @RequiresFeature(FEATURE_KEYS.QUESTION_AUTHORING, PERMISSION_LEVELS.READ)
  @Post('duplicate')
  async duplicate(
    @Body(new ZodBody(authoringDuplicateQuerySchema)) body: AuthoringDuplicateQuery,
  ): Promise<AuthoringDuplicate> {
    const { exceptId, ...draft } = body;
    return { duplicateOf: await this.authoring.duplicateFor(draft, exceptId) };
  }

  @Audit(AUDIT_FEATURE.QUESTION, AUDIT_ACTION.CREATE)
  @RequiresFeature(FEATURE_KEYS.QUESTION_AUTHORING, PERMISSION_LEVELS.WRITE)
  @Post('questions')
  create(
    @Body(new ZodBody(authoringCreateSchema)) body: AuthoringCreateInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AuthoringSaveResult> {
    const { assignmentId, ...draft } = body;
    return this.authoring.create(draft, user.id, assignmentId ?? null, user.isSuperAdmin);
  }

  @Audit(AUDIT_FEATURE.QUESTION, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.QUESTION_AUTHORING, PERMISSION_LEVELS.WRITE)
  @Patch('questions/:id')
  update(
    @Param('id') id: string,
    @Body(new ZodBody(questionDraftSchema)) body: QuestionDraft,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AuthoringSaveResult> {
    return this.authoring.update(id, body, user.id);
  }

  /** The typist's own mistake, taken back. `questions.remove` still refuses anything in use. */
  @Audit(AUDIT_FEATURE.QUESTION, AUDIT_ACTION.DELETE)
  @RequiresFeature(FEATURE_KEYS.QUESTION_AUTHORING, PERMISSION_LEVELS.WRITE)
  @HttpCode(HttpStatus.OK)
  @Delete('questions/:id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.authoring.remove(id, user.id, user.isSuperAdmin);
  }

  /** The same sheet the bank's importer reads, landing in the section rather than loose. */
  @RequiresFeature(FEATURE_KEYS.QUESTION_AUTHORING, PERMISSION_LEVELS.WRITE)
  @HttpCode(HttpStatus.OK)
  @Post('assignments/:assignmentId/import/preview')
  @UseInterceptors(FileInterceptor(IMPORT_FILE_FIELD))
  previewImport(
    @Param('assignmentId') assignmentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: UploadedSheet,
  ): Promise<QuestionImportPlan> {
    return this.imports.previewForAssignment(
      assignmentId,
      requireFile(file),
      user.id,
      user.isSuperAdmin,
    );
  }

  @Audit(AUDIT_FEATURE.QUESTION, AUDIT_ACTION.CREATE)
  @RequiresFeature(FEATURE_KEYS.QUESTION_AUTHORING, PERMISSION_LEVELS.WRITE)
  @HttpCode(HttpStatus.OK)
  @Post('assignments/:assignmentId/import/commit')
  commitImport(
    @Param('assignmentId') assignmentId: string,
    @Body(new ZodBody(questionImportCommitSchema)) body: QuestionImportCommitBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionImportResult> {
    return this.imports.commitForAssignment(
      assignmentId,
      body.importLogId,
      user.id,
      user.isSuperAdmin,
    );
  }

  @RequiresFeature(FEATURE_KEYS.QUESTION_AUTHORING, PERMISSION_LEVELS.WRITE)
  @HttpCode(HttpStatus.OK)
  @Post('assignments/:assignmentId/release')
  release(
    @Param('assignmentId') assignmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AuthoringRelease> {
    return this.authoring.release(assignmentId, user.id, user.isSuperAdmin);
  }
}
