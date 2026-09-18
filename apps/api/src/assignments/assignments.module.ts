import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminsModule } from '../admins';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';

/** One person's job on one section of one test — assigning it, the queue, and finalising it (docs/03 §4.1). */
@Module({
  imports: [PrismaModule, AdminsModule],
  controllers: [AssignmentsController],
  providers: [AssignmentsService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
