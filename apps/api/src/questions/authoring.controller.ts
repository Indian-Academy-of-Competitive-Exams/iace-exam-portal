import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ActorTypes,
  AUDIT_ACTION,
  AUDIT_FEATURE,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  authoringHistoryQuerySchema,
  questionDraftSchema,
  type AuthoringHistoryQuery,
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
import { AuthoringService } from './authoring.service';

/** Hiding the nav is not what keeps a typist out of the bank — these routes and their scoping are. */
@Controller('admin/authoring')
@Actors(ActorTypes.ADMIN)
@RequiresFeature(FEATURE_KEYS.QUESTION_AUTHORING, PERMISSION_LEVELS.READ)
export class AuthoringController {
  constructor(private readonly authoring: AuthoringService) {}

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

  @Audit(AUDIT_FEATURE.QUESTION, AUDIT_ACTION.CREATE)
  @RequiresFeature(FEATURE_KEYS.QUESTION_AUTHORING, PERMISSION_LEVELS.WRITE)
  @Post('questions')
  create(
    @Body(new ZodBody(questionDraftSchema)) body: QuestionDraft,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AuthoringSaveResult> {
    return this.authoring.create(body, user.id);
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
}
