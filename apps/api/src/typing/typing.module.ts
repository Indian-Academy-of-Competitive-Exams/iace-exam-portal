import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { API_ROLES, onRole } from '../config/api-role';
import { TypingPracticeController } from './typing-practice.controller';
import { TypingService } from './typing.service';

/** Owns `TypingPractice`. Apart from tests: nothing here is ranked. It only reads the bank. */
@Module({
  imports: [PrismaModule],
  controllers: onRole([API_ROLES.CORE], [TypingPracticeController]),
  providers: [TypingService],
})
export class TypingModule {}
