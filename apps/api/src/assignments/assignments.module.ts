import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminsModule } from '../admins';
import { StorageModule } from '../storage/storage.module';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { SectionThreadService } from './section-thread.service';
import { API_ROLES, onRole } from '../config/api-role';

/** One person's job on one section of one test — assigning it, the queue, and finalising it (docs/03 §4.1). */
@Module({
  imports: [PrismaModule, AdminsModule, StorageModule],
  controllers: onRole([API_ROLES.CORE], [AssignmentsController]),
  providers: [AssignmentsService, SectionThreadService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
