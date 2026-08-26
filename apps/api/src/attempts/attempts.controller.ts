import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  ActorTypes,
  saveAttemptStateSchema,
  startAttemptSchema,
  type ExamPaper,
  type LiveAttempt,
  type LiveAttemptState,
  type SaveAttemptStateBody,
  type StartAttemptBody,
  type SubmittedAttempt,
} from '@iace/contracts';
import { Actors, CurrentUser, type AuthenticatedUser } from '../common/security';
import { ZodBody } from '../common/zod-validation.pipe';
import { AttemptsService } from './attempts.service';
import { AttemptPaperService } from './attempt-paper.service';
import { AttemptStateService } from './attempt-state.service';
import { SubmitService } from './submit.service';

/** The student's own sittings. The subject is always the token's, never a path parameter. */
@Controller('me')
@Actors(ActorTypes.STUDENT)
export class AttemptsController {
  constructor(
    private readonly attempts: AttemptsService,
    private readonly papers: AttemptPaperService,
    private readonly state: AttemptStateService,
    private readonly submitter: SubmitService,
  ) {}

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

  /** The student's OWN paper. Another student's id reads as missing, not as refused. */
  @Get('attempts/:id/paper')
  paper(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<ExamPaper> {
    return this.papers.paper(user.id, id);
  }

  /** Ends the sitting. A second call reports the first one's outcome rather than refusing. */
  @Post('attempts/:id/submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SubmittedAttempt> {
    return this.submitter.submit(user.id, id);
  }

  /** The autosave. Writes Redis and nothing else — this is the hot path the scaling rules name. */
  @Patch('attempts/:id/state')
  saveState(
    @Param('id') id: string,
    @Body(new ZodBody(saveAttemptStateSchema)) body: SaveAttemptStateBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LiveAttemptState> {
    return this.state.save(user.id, id, body);
  }
}
