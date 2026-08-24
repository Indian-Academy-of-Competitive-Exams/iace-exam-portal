import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ActorTypes,
  startAttemptSchema,
  type LiveAttempt,
  type StartAttemptBody,
} from '@iace/contracts';
import { Actors, CurrentUser, type AuthenticatedUser } from '../common/security';
import { ZodBody } from '../common/zod-validation.pipe';
import { AttemptsService } from './attempts.service';

/** The student's own sittings. The subject is always the token's, never a path parameter. */
@Controller('me')
@Actors(ActorTypes.STUDENT)
export class AttemptsController {
  constructor(private readonly attempts: AttemptsService) {}

  /** Idempotent: a second start while one is running resumes it, clock and all. */
  @Post('tests/:testId/attempt')
  @HttpCode(HttpStatus.OK)
  start(
    @Param('testId') testId: string,
    @Body(new ZodBody(startAttemptSchema)) body: StartAttemptBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LiveAttempt> {
    return this.attempts.start(user.id, testId, body);
  }
}
