import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { uploadLimit } from '../common/importing/upload';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { AuthoringController } from './authoring.controller';
import { AuthoringService } from './authoring.service';
import { QuestionImportController } from './question-import.controller';
import { StemRehashService } from './stem-rehash.service';
import { QuestionImportService } from './question-import.service';
import { SectionWorkController } from './section-work.controller';
import { SectionWorkService } from './section-work.service';
import { AssignmentsModule } from '../assignments';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { TaxonomyController } from './taxonomy.controller';
import { TaxonomyService } from './taxonomy.service';
import { API_ROLES, onRole } from '../config/api-role';

/** Declares its own infra rather than assuming `app.module` provides it (docs/03 §4.5). */
@Module({
  imports: [
    PrismaModule,
    // The uploaded sheet is kept, so a commit re-reads exactly what was previewed.
    StorageModule,
    AppConfigModule,
    // A section's work reads who holds it through the module that owns the assignments.
    AssignmentsModule,
    uploadLimit,
  ],
  controllers: onRole(
    [API_ROLES.CORE],
    [
      QuestionsController,
      TaxonomyController,
      QuestionImportController,
      AuthoringController,
      SectionWorkController,
    ],
  ),
  providers: [
    QuestionsService,
    TaxonomyService,
    QuestionImportService,
    AuthoringService,
    SectionWorkService,
    StemRehashService,
  ],
  exports: [QuestionsService, TaxonomyService],
})
export class QuestionsModule {}
