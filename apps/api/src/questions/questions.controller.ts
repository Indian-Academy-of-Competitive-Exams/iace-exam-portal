import {
  Body,
  Controller,
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
  PERMISSION_LEVELS,
  questionDraftSchema,
  QUESTION_IMAGE_FILE_FIELD,
  bulkQuestionStatusSchema,
  questionListQuerySchema,
  setQuestionStatusSchema,
  type Paginated,
  type QuestionDetail,
  type QuestionDraft,
  type BulkQuestionStatusBody,
  type BulkQuestionStatusResult,
  type QuestionImage,
  type QuestionListQuery,
  type QuestionSummary,
  type SetQuestionStatusBody,
} from '@iace/contracts';
import { Actors, CurrentUser, RequiresFeature, type AuthenticatedUser } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { QuestionsService } from './questions.service';

/** What multer hands back; typed here rather than pulling Express types into a controller. */
interface UploadedFileLike {
  buffer: Buffer;
  size: number;
  mimetype: string;
}

/** The question bank itself. Every route is gated on QUESTION_MANAGEMENT. */
@Controller('admin/questions')
@Actors(ActorTypes.ADMIN)
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @RequiresFeature(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get()
  list(
    @Query(new ZodQuery(questionListQuerySchema)) query: QuestionListQuery,
  ): Promise<Paginated<QuestionSummary>> {
    return this.questions.list(query);
  }

  /** Before `:id`, or "images" is read as a question id. */
  @Audit(AUDIT_FEATURE.QUESTION, AUDIT_ACTION.CREATE)
  @RequiresFeature(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post('images')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor(QUESTION_IMAGE_FILE_FIELD))
  uploadImage(@UploadedFile() file?: UploadedFileLike): Promise<QuestionImage> {
    return this.questions.saveImage(file);
  }

  /** Before `:id`, or "status" is read as a question id. */
  @Audit(AUDIT_FEATURE.QUESTION, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch('status')
  bulkSetStatus(
    @Body(new ZodBody(bulkQuestionStatusSchema)) body: BulkQuestionStatusBody,
  ): Promise<BulkQuestionStatusResult> {
    return this.questions.bulkSetStatus(body);
  }

  @RequiresFeature(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Get(':id')
  detail(@Param('id') id: string): Promise<QuestionDetail> {
    return this.questions.detail(id);
  }

  @Audit(AUDIT_FEATURE.QUESTION, AUDIT_ACTION.CREATE)
  @RequiresFeature(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Post()
  create(
    @Body(new ZodBody(questionDraftSchema)) body: QuestionDraft,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionDetail> {
    // The author comes from the token, never the body: a client that can name
    // who wrote a question can put anyone's name on it.
    return this.questions.create(body, user.id);
  }

  @Audit(AUDIT_FEATURE.QUESTION, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodBody(questionDraftSchema)) body: QuestionDraft,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionDetail> {
    // Same reason as create: the version records who wrote it, from the token.
    return this.questions.update(id, body, user.id);
  }

  @Audit(AUDIT_FEATURE.QUESTION, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE)
  @Patch(':id/status')
  setStatus(
    @Param('id') id: string,
    @Body(new ZodBody(setQuestionStatusSchema)) body: SetQuestionStatusBody,
  ): Promise<QuestionDetail> {
    return this.questions.setStatus(id, body);
  }
}
