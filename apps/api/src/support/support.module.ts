import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { API_ROLES, onRole } from '../config/api-role';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

/** Owns `SupportTicket` and `SupportMessage`. */
@Module({
  imports: [PrismaModule, StorageModule],
  controllers: onRole([API_ROLES.CORE], [SupportController]),
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
