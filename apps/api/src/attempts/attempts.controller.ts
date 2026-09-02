import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  ActorTypes,
  saveAttemptStateSchema,
  startAttemptSchema,
  type ExamBrief,
  type ExamPaper,
  type LiveAttempt,
  type LiveAttemptState,
  type SaveAttemptStateBody,
  type AttemptAnalytics,
  type PerformanceTrend,
  type ScoreCard,
  type SolutionReport,
  type StartAttemptBody,
  type SubmittedAttempt,
} from '@iace/contracts';
import { Actors, CurrentUser, type AuthenticatedUser } from '../common/security';
import { SittingRateLimit } from '../common/throttling';
import { ZodBody } from '../common/zod-validation.pipe';
import { AttemptsService } from './attempts.service';
import { AttemptPaperService } from './attempt-paper.service';
import { AttemptReportService } from './attempt-report.service';
import { AttemptStateService } from './attempt-state.service';
import { SubmitService } from './submit.service';

/** The student's own sittings. The subject is always the token's, never a path parameter. */
@Controller('me')
@Actors(ActorTypes.STUDENT)
export class AttemptsController {
  constructor(
    private readonly attempts: AttemptsService,
    private readonly papers: AttemptPaperService,
    private readonly reports: AttemptReportService,
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

  /** What the student reads before the clock starts. Carries no question and no answer. */
  @Get('tests/:testId/brief')
  brief(
    @Param('testId') testId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ExamBrief> {
    return this.papers.brief(user.id, testId);
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
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SubmittedAttempt> {
    return this.submitter.submit(user.id, id);
  }

  /** Marks, standing and their OWN answers. Carries no correct option, on any question. */
  @Get('attempts/:id/scorecard')
  scoreCard(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<ScoreCard> {
    return this.reports.scoreCard(user.id, id);
  }

  /** The answer key, and the ONLY endpoint carrying it. Refused until the gate opens. */
  @Get('attempts/:id/solutions')
  solutions(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SolutionReport> {
    return this.reports.solutions(user.id, id);
  }

  /** How the paper was sat — accuracy, time and strategy, all derived from what the exam wrote. */
  @Get('attempts/:id/analytics')
  analytics(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AttemptAnalytics> {
    return this.reports.analytics(user.id, id);
  }

  /** Every test this student has sat, oldest first — the line the Performance tab draws. */
  @Get('performance')
  performance(@CurrentUser() user: AuthenticatedUser): Promise<PerformanceTrend> {
    return this.reports.performance(user.id);
  }

  /** The autosave. Writes Redis and nothing else — this is the hot path the scaling rules name. */
  @SittingRateLimit()
  @Patch('attempts/:id/state')
  saveState(
    @Param('id') id: string,
    @Body(new ZodBody(saveAttemptStateSchema)) body: SaveAttemptStateBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LiveAttemptState> {
    return this.state.save(user.id, id, body);
  }
}
