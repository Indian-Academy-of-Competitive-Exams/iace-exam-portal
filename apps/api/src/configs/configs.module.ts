import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { type StudentsModule } from '../students';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';
import { ExamStagesController } from './exam-stages.controller';
import { ExamStagesService } from './exam-stages.service';
import { BaseConfigsController } from './base-configs.controller';
import { BaseConfigsService } from './base-configs.service';

/** Owns the catalog — `Exam`, `ExamStage` — and the blueprints built on it. forwardRef: students
 *  validate enrolments against the catalog, and the catalog counts enrolments back. */
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
  controllers: [ExamsController, ExamStagesController, BaseConfigsController],
  providers: [ExamsService, ExamStagesService, BaseConfigsService],
  exports: [ExamsService, ExamStagesService, BaseConfigsService],
})
export class ConfigsModule {}
