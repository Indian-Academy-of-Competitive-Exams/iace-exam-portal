import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/app-config.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { AuthoringController } from './authoring.controller';
import { AuthoringService } from './authoring.service';
import { QuestionImportController } from './question-import.controller';
import { QuestionImportService } from './question-import.service';
import { ProofreadingController } from './proofreading.controller';
import { ProofreadingService } from './proofreading.service';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { TaxonomyController } from './taxonomy.controller';
import { TaxonomyService } from './taxonomy.service';

/** Declares its own infra rather than assuming `app.module` provides it (docs/03 §4.5). */
@Module({
  imports: [
    PrismaModule,
    // The uploaded sheet is kept, so a commit re-reads exactly what was previewed.
    StorageModule,
    AppConfigModule,
    /** The upload ceiling, applied WHILE the body arrives. */
    MulterModule.registerAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        limits: { fileSize: config.importLimitBytes, files: 1 },
      }),
    }),
  ],
  controllers: [
    QuestionsController,
    TaxonomyController,
    QuestionImportController,
    AuthoringController,
    ProofreadingController,
  ],
  providers: [
    QuestionsService,
    TaxonomyService,
    QuestionImportService,
    AuthoringService,
    ProofreadingService,
  ],
  exports: [QuestionsService, TaxonomyService],
})
export class QuestionsModule {}
