import { Module } from '@nestjs/common';
import { MessagingModule } from '../common/messaging';
import { NotificationsModule } from '../notifications';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { API_ROLES, onRole } from '../config/api-role';
import { SupportAdminController } from './support-admin.controller';
import { SupportAdminService } from './support-admin.service';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

/** Owns `SupportTicket` and `SupportMessage`. */
@Module({
  imports: [PrismaModule, StorageModule, NotificationsModule, MessagingModule],
  controllers: onRole([API_ROLES.CORE], [SupportController, SupportAdminController]),
  providers: [SupportService, SupportAdminService],
  exports: [SupportService],
})
export class SupportModule {}
