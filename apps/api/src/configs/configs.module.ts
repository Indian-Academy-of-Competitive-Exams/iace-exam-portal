import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { type StudentsModule } from '../students';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';
import { ExamStagesController } from './exam-stages.controller';
import { ExamStagesService } from './exam-stages.service';

/** Owns `Exam` and `ExamStage`. forwardRef: students validate enrolments against the catalog,
 *  and the catalog counts enrolments back. */
@Module({
  imports: [
    PrismaModule,
    // `require`, not a static import: a top-level import here re-enters the still-loading
    // `students` barrel and throws; a CommonJS `require` tolerates the partial circular load.
    forwardRef(
      () =>
        (module.require('../students') as { StudentsModule: typeof StudentsModule }).StudentsModule,
    ),
  ],
  controllers: [ExamsController, ExamStagesController],
  providers: [ExamsService, ExamStagesService],
  exports: [ExamsService, ExamStagesService],
})
export class ConfigsModule {}
