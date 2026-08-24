import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AccessModule } from '../access';
import { AttemptsController } from './attempts.controller';
import { AttemptsService } from './attempts.service';

/** Owns `Attempt` — the live sitting. AccessModule because the start guard is the catalog's own. */
@Module({
  imports: [PrismaModule, AccessModule],
  controllers: [AttemptsController],
  providers: [AttemptsService],
  exports: [AttemptsService],
})
export class AttemptsModule {}
