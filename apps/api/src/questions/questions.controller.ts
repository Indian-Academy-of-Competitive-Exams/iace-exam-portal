import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ActorTypes,
  AUDIT_ACTION,
  AUDIT_FEATURE,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  questionDraftSchema,
  questionListQuerySchema,
  setQuestionStatusSchema,
  type Paginated,
  type QuestionDetail,
  type QuestionDraft,
  type QuestionListQuery,
  type QuestionSummary,
  type SetQuestionStatusBody,
} from '@iace/contracts';
import { Actors, CurrentUser, RequiresFeature, type AuthenticatedUser } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { QuestionsService } from './questions.service';

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
