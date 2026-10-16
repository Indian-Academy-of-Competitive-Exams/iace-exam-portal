import { Module } from '@nestjs/common';
import { MessagingModule } from '../common/messaging';
import { NotificationsModule } from '../notifications';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { API_ROLES, onRole } from '../config/api-role';
import { SupportAdminController } from './support-admin.controller';
import { SupportAdminService } from './support-admin.service';
import { RedisModule } from '../redis/redis.module';
import { LoginHelpService } from './login-help.service';
import { LoginHelpController, SupportController } from './support.controller';
import { SupportService } from './support.service';

/** Owns `SupportTicket` and `SupportMessage`. */
@Module({
  imports: [PrismaModule, StorageModule, NotificationsModule, MessagingModule, RedisModule],
  controllers: onRole(
    [API_ROLES.CORE],
    [SupportController, LoginHelpController, SupportAdminController],
  ),
  providers: [SupportService, SupportAdminService, LoginHelpService],
  exports: [SupportService],
})
export class SupportModule {}
