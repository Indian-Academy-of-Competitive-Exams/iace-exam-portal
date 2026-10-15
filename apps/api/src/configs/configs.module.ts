import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';
import { ExamStagesController } from './exam-stages.controller';
import { ExamStagesService } from './exam-stages.service';
import { BaseConfigsController } from './base-configs.controller';
import { BaseConfigsService } from './base-configs.service';
import { API_ROLES, onRole } from '../config/api-role';

/** Owns the catalog — `Exam`, `ExamStage` — and the blueprints built on it. */
@Module({
  imports: [PrismaModule],
  controllers: onRole(
    [API_ROLES.CORE],
    [ExamsController, ExamStagesController, BaseConfigsController],
  ),
  providers: [ExamsService, ExamStagesService, BaseConfigsService],
  exports: [ExamsService, ExamStagesService, BaseConfigsService],
})
export class ConfigsModule {}
