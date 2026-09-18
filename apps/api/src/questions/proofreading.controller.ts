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
} from '@nestjs/common';
import {
  ActorTypes,
  AUDIT_ACTION,
  AUDIT_FEATURE,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  createQuestionFlagSchema,
  questionDraftSchema,
  questionListQuerySchema,
  settleQuestionFlagSchema,
  type CreateQuestionFlagBody,
  type Paginated,
  type ProofreadQuestion,
  type QuestionDetail,
  type QuestionDraft,
  type QuestionFlag,
  type QuestionListQuery,
  type SettleQuestionFlagBody,
} from '@iace/contracts';
import { Actors, CurrentUser, RequiresFeature, type AuthenticatedUser } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { ProofreadingService } from './proofreading.service';

/** Its own key: a reviewer reads and flags, and needs neither the bank's edit rights nor authoring. */
@Controller('admin/proofreading')
@Actors(ActorTypes.ADMIN)
export class ProofreadingController {
  constructor(private readonly proofreading: ProofreadingService) {}

  /** The same filters the bank is browsed with — a proof-reader loads exactly the set they want. */
  @RequiresFeature(FEATURE_KEYS.QUESTION_PROOFREAD, PERMISSION_LEVELS.READ)
  @Get('questions')
  document(
    @Query(new ZodQuery(questionListQuerySchema)) query: QuestionListQuery,
  ): Promise<Paginated<ProofreadQuestion>> {
    return this.proofreading.document(query);
  }

  @RequiresFeature(FEATURE_KEYS.QUESTION_PROOFREAD, PERMISSION_LEVELS.WRITE)
  @Post('questions/:id/flags')
  @HttpCode(HttpStatus.CREATED)
  raise(
    @Param('id') id: string,
    @Body(new ZodBody(createQuestionFlagSchema)) body: CreateQuestionFlagBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionFlag> {
    // The reviewer comes from the token: a client that can name who raised a flag can forge one.
    return this.proofreading.raise(id, body, user.id);
  }

  /** Scoped to one section by the assignment named, and refused when it is not the caller's. */
  @RequiresFeature(FEATURE_KEYS.QUESTION_PROOFREAD, PERMISSION_LEVELS.READ)
  @Get('assignments/:assignmentId/questions')
  forAssignment(
    @Param('assignmentId') assignmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ProofreadQuestion[]> {
    return this.proofreading.forAssignment(assignmentId, user.id);
  }

  /** The point of the feature: a reader fixes what they find rather than only naming it. */
  @Audit(AUDIT_FEATURE.QUESTION, AUDIT_ACTION.UPDATE)
  @RequiresFeature(FEATURE_KEYS.QUESTION_PROOFREAD, PERMISSION_LEVELS.WRITE)
  @Patch('assignments/:assignmentId/questions/:questionId')
  editQuestion(
    @Param('assignmentId') assignmentId: string,
    @Param('questionId') questionId: string,
    @Body(new ZodBody(questionDraftSchema)) body: QuestionDraft,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionDetail> {
    return this.proofreading.editQuestion(assignmentId, questionId, body, user.id);
  }

  @RequiresFeature(FEATURE_KEYS.QUESTION_PROOFREAD, PERMISSION_LEVELS.WRITE)
  @Patch('flags/:flagId')
  settle(
    @Param('flagId') flagId: string,
    @Body(new ZodBody(settleQuestionFlagSchema)) body: SettleQuestionFlagBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionFlag> {
    return this.proofreading.settle(flagId, body, user.id);
  }
}
