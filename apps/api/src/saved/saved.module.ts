import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AccessModule } from '../access';
import { SavedController } from './saved.controller';
import { SavedQuestionsService } from './saved-questions.service';
import { API_ROLES, onRole } from '../config/api-role';

/** Owns `SavedQuestion`. AccessModule because the star rides the solution gate's own schedule. */
@Module({
  imports: [PrismaModule, AccessModule],
  controllers: onRole([API_ROLES.CORE], [SavedController]),
  providers: [SavedQuestionsService],
  exports: [SavedQuestionsService],
})
export class SavedModule {}
