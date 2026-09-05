/**
 * The two ways into one per-question table. The student's path takes its subject from the token;
 * the admin's names one in the path and pays for it with STUDENT_PERFORMANCE.
 */
import { Controller, Get, Param } from '@nestjs/common';
import { ActorTypes, FEATURE_KEYS, PERMISSION_LEVELS, type QuestionReport } from '@iace/contracts';
import { Actors, CurrentUser, RequiresFeature, type AuthenticatedUser } from '../common/security';
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

@Controller('admin/students/:studentId/attempts')
@Actors(ActorTypes.ADMIN)
export class AdminQuestionReportController {
  constructor(private readonly questions: QuestionReportService) {}

  /** The same payload the student reads, for any student in the admin's own branches. */
  @RequiresFeature(FEATURE_KEYS.STUDENT_PERFORMANCE, PERMISSION_LEVELS.READ)
  @Get(':id/question-report')
  report(
    @Param('studentId') studentId: string,
    @Param('id') attemptId: string,
  ): Promise<QuestionReport> {
    return this.questions.forStudent(studentId, attemptId);
  }
}
