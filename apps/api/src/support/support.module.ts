import { Module, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import { MessagingModule } from '../common/messaging';
import { NotificationsModule } from '../notifications';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { API_ROLES, onRole, servesRole } from '../config/api-role';
import { keepScheduled } from '../queue/keep-scheduled';
import { QueueModule } from '../queue/queue.module';
import { QUEUE_NAMES, SUPPORT_AUTOCLOSE_CRON } from '../queue/queues';
import { SupportAutocloseProcessor } from './support-autoclose.processor';
import { SupportAdminController } from './support-admin.controller';
import { SupportAdminService } from './support-admin.service';
import { RedisModule } from '../redis/redis.module';
import { LoginHelpService } from './login-help.service';
import { LoginHelpController, SupportController } from './support.controller';
import { SupportService } from './support.service';

/** Owns `SupportTicket` and `SupportMessage`. */
@Module({
  imports: [
    PrismaModule,
    QueueModule,
    StorageModule,
    NotificationsModule,
    MessagingModule,
    RedisModule,
  ],
  controllers: onRole(
    [API_ROLES.CORE],
    [SupportController, LoginHelpController, SupportAdminController],
  ),
  providers: [
    SupportService,
    SupportAdminService,
    LoginHelpService,
    ...onRole([API_ROLES.WORKER], [SupportAutocloseProcessor]),
  ],
  exports: [SupportService],
})
export class SupportModule implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_NAMES.SUPPORT_AUTOCLOSE) private readonly autoclose: Queue) {}

  async onModuleInit(): Promise<void> {
    if (!servesRole(API_ROLES.WORKER)) return;
    await keepScheduled(this.autoclose, async () => {
      await this.autoclose.upsertJobScheduler(QUEUE_NAMES.SUPPORT_AUTOCLOSE, {
        pattern: SUPPORT_AUTOCLOSE_CRON,
        tz: 'UTC',
      });
    });
  }
}
