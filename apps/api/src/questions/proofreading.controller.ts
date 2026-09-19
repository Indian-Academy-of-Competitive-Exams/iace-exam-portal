import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  ActorTypes,
  AUDIT_ACTION,
  AUDIT_FEATURE,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  questionDraftSchema,
  type QuestionDetail,
  type QuestionDraft,
  type QuestionOnOtherTest,
} from '@iace/contracts';
import { Actors, CurrentUser, RequiresFeature, type AuthenticatedUser } from '../common/security';
import { ZodBody } from '../common/zod-validation.pipe';
import { Audit } from '../audit';
import { ProofreadingService } from './proofreading.service';

/** Its own key: a reviewer reads and fixes, and needs neither the bank's edit rights nor authoring. */
@Controller('admin/proofreading')
@Actors(ActorTypes.ADMIN)
export class ProofreadingController {
  constructor(private readonly proofreading: ProofreadingService) {}

  /** Scoped to one section by the assignment named, and refused when it is not the caller's. */
  @RequiresFeature(FEATURE_KEYS.QUESTION_PROOFREAD, PERMISSION_LEVELS.READ)
  @Get('assignments/:assignmentId/questions')
  forAssignment(
    @Param('assignmentId') assignmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionDetail[]> {
    return this.proofreading.forAssignment(assignmentId, user.id, user.isSuperAdmin);
  }

  /** Read before the edit, not after: it is what makes the edit warning conditional. */
  @RequiresFeature(FEATURE_KEYS.QUESTION_PROOFREAD, PERMISSION_LEVELS.READ)
  @Get('assignments/:assignmentId/questions/:questionId/other-tests')
  otherTests(
    @Param('assignmentId') assignmentId: string,
    @Param('questionId') questionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionOnOtherTest[]> {
    return this.proofreading.otherTests(assignmentId, questionId, user.id, user.isSuperAdmin);
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
    return this.proofreading.editQuestion(
      assignmentId,
      questionId,
      body,
      user.id,
      user.isSuperAdmin,
    );
  }
}
