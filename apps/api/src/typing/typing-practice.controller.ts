import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import {
  ActorTypes,
  finishTypingPracticeSchema,
  typingPracticeListQuerySchema,
  typingPracticePassageQuerySchema,
  type FinishTypingPracticeBody,
  type Paginated,
  type TypingPractice,
  type TypingPracticeListQuery,
  type TypingPracticePassage,
  type TypingPracticePassageQuery,
} from '@iace/contracts';
import { Actors, CurrentUser, type AuthenticatedUser } from '../common/security';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { TypingService } from './typing.service';

/** Their own typing practice. No id names a student here — the token is the subject, as under `me`. */
@Controller('me/typing')
@Actors(ActorTypes.STUDENT)
export class TypingPracticeController {
  constructor(private readonly typing: TypingService) {}

  @Get('passage')
  passage(
    @Query(new ZodQuery(typingPracticePassageQuerySchema)) query: TypingPracticePassageQuery,
  ): Promise<TypingPracticePassage> {
    return this.typing.passageFor(query.presetKey);
  }

  @Post('practices')
  @HttpCode(HttpStatus.OK)
  finish(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(finishTypingPracticeSchema)) body: FinishTypingPracticeBody,
  ): Promise<TypingPractice> {
    return this.typing.finish(user.id, body);
  }

  @Get('practices')
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodQuery(typingPracticeListQuerySchema)) query: TypingPracticeListQuery,
  ): Promise<Paginated<TypingPractice>> {
    return this.typing.history(user.id, query);
  }
}
