import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { AccessModule } from '../access';
import { EventsModule } from '../events';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { uploadLimit } from '../common/importing/upload';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { API_ROLES, onRole } from '../config/api-role';

@Module({
  // EventsModule for the roster, AccessModule for the program catalog.
  imports: [PrismaModule, StorageModule, AuditModule, EventsModule, AccessModule, uploadLimit],
  controllers: onRole([API_ROLES.CORE], [ImportsController]),
  providers: [ImportsService],
})
export class ImportsModule {}
