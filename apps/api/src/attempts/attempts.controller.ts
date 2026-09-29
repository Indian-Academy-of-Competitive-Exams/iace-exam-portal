import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ActorTypes,
  saveAttemptStateSchema,
  startAttemptSchema,
  submitAttemptSchema,
  type AttemptSaveAck,
  type ExamBrief,
  type ExamPaper,
  languageCodeSchema,
  type SharedPaper,
  type LanguageCode,
  type StartedAttempt,
  type LiveAttemptState,
  type SaveAttemptStateBody,
  type StartAttemptBody,
  type SubmitAttemptBody,
  type SubmittedAttempt,
} from '@iace/contracts';
import { Actors, CurrentUser, type AuthenticatedUser } from '../common/security';
import { SittingRateLimit } from '../common/throttling';
import { ZodBody } from '../common/zod-validation.pipe';
import { AttemptsService } from './attempts.service';
import { AttemptPaperService } from './attempt-paper.service';
import { AttemptStateService } from './attempt-state.service';
import { SubmitService } from './submit.service';

/** A query string says anything, so only codes the enum knows reach the resolver. */
function languageCodesIn(raw: string | undefined): LanguageCode[] | undefined {
  if (raw === undefined) return undefined;
  const codes = raw
    .split(',')
    .map((part) => languageCodeSchema.safeParse(part.trim()))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  return codes.length > 0 ? codes : undefined;
}

/** The live sitting only: starting, autosaving, submitting. Anything read after it ends sits on core. */
@Controller('me')
@Actors(ActorTypes.STUDENT)
export class AttemptsController {
  private readonly logger = new Logger(AttemptsController.name);

  constructor(
    private readonly attempts: AttemptsService,
    private readonly papers: AttemptPaperService,
    private readonly state: AttemptStateService,
    private readonly submitter: SubmitService,
  ) {}

  /** Idempotent: a second start while one is running resumes it, clock and all. */
  @SittingRateLimit()
  @Post('tests/:testId/attempt')
  @HttpCode(HttpStatus.OK)
  async start(
    @Param('testId') testId: string,
    @Body(new ZodBody(startAttemptSchema)) body: StartAttemptBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StartedAttempt> {
    const attempt = await this.attempts.start(user.id, testId, body);
    // A screen holding the paper already would throw this copy away; one that cannot build it asks again.
    const paper = body.holdsPaper
      ? null
      : await this.papers.paper(user.id, attempt.id).catch((error: unknown) => {
          this.logger.error(`Paper for sitting ${attempt.id} did not build with its start`, error);
          return null;
        });

    return { ...attempt, paper, serverNow: new Date().toISOString() };
  }

  /** What the student reads before the clock starts. Carries no question and no answer. */
  @Get('tests/:testId/brief')
  brief(
    @Param('testId') testId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ExamBrief> {
    return this.papers.brief(user.id, testId);
  }

  /** The paper before any sitting exists, so a screen can hold it while the clock is still to start. */
  @Get('tests/:testId/paper')
  testPaper(
    @Param('testId') testId: string,
    @Query('languages') languages: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SharedPaper> {
    return this.papers.testPaper(user.id, testId, languageCodesIn(languages));
  }

  /** The student's OWN paper. Another student's id reads as missing, not as refused. */
  @Get('attempts/:id/paper')
  paper(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<ExamPaper> {
    return this.papers.paper(user.id, id);
  }

  /** Ends the sitting. A second call reports the first one's outcome rather than refusing. */
  @SittingRateLimit()
  @Post('attempts/:id/submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @Param('id') id: string,
    @Body(new ZodBody(submitAttemptSchema)) body: SubmitAttemptBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SubmittedAttempt> {
    return this.submitter.submit(user.id, id, body);
  }

  /** The autosave. Writes Redis and nothing else — this is the hot path the scaling rules name. */
  @SittingRateLimit()
  @Patch('attempts/:id/state')
  saveState(
    @Param('id') id: string,
    @Body(new ZodBody(saveAttemptStateSchema)) body: SaveAttemptStateBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AttemptSaveAck> {
    return this.state.save(user.id, id, body);
  }

  /** The sitting as the server holds it, so a reloaded tab does not show a blank palette. */
  @Get('attempts/:id/state')
  liveState(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LiveAttemptState> {
    return this.state.current(user.id, id);
  }
}
