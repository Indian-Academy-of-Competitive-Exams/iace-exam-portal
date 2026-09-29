import { Controller, Get, Param } from '@nestjs/common';
import { ActorTypes, type QuestionReport } from '@iace/contracts';
import { Actors, CurrentUser, type AuthenticatedUser } from '../common/security';
import { QuestionReportService } from './question-report.service';

@Controller('me/attempts')
@Actors(ActorTypes.STUDENT)
export class MeQuestionReportController {
  constructor(private readonly questions: QuestionReportService) {}

  /** Their own sitting, question by question, with the cohort beside it. */
  @Get(':id/question-report')
  report(
    @Param('id') attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<QuestionReport> {
    return this.questions.forAttempt(user.id, attemptId);
  }
}
