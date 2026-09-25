import { Module } from '@nestjs/common';
import { EventsModule } from '../common/events/events.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminsController } from './admins.controller';
import { AdminsService } from './admins.service';
import { API_ROLES, onRole } from '../config/api-role';

/** Admin management and feature-level access control. */
@Module({
  imports: [PrismaModule, EventsModule],
  controllers: onRole([API_ROLES.CORE], [AdminsController]),
  providers: [AdminsService],
  exports: [AdminsService],
})
export class AdminsModule {}
