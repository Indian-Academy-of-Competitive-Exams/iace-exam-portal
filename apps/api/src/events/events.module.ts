import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { API_ROLES, onRole } from '../config/api-role';

/** Owns `Event` and `EventCandidate` — who an EVENT series draws its roster from. */
@Module({
  imports: [PrismaModule],
  controllers: onRole([API_ROLES.CORE], [EventsController]),
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
