import { forwardRef, Module, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { type AccessModule } from '../access';
import { QueueModule } from '../queue/queue.module';
import {
  NOTIFICATION_JOBS,
  NOTIFICATION_SWEEP_EVERY_MS,
  QUEUE_NAMES,
  TESTS_OPENED_SWEEP_EVERY_MS,
} from '../queue/queues';
import { NotificationsService } from './notifications.service';
import { NotificationOutbox } from './notification-outbox';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationDeliveryProcessor } from './notification-delivery.processor';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementsController } from './announcements.controller';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PushService } from './push.service';
import { TestOpeningService } from './test-opening.service';
import { NotificationListener } from './notification.listener';
import { PUSH_SENDER, WebPushSender } from './web-push.sender';

/** Owns the ledger, the preferences and the push endpoints. No controller: both hang off `me`. */
@Module({
  imports: [
    PrismaModule,
    QueueModule,
    // `require`, not a static import: `access` imports this barrel back and would re-enter it.
    forwardRef(
      () => (module.require('../access') as { AccessModule: typeof AccessModule }).AccessModule,
    ),
  ],
  controllers: [AnnouncementsController],
  providers: [
    AnnouncementsService,
    NotificationsService,
    NotificationPreferencesService,
    NotificationOutbox,
    NotificationsProcessor,
    NotificationDeliveryProcessor,
    PushService,
    TestOpeningService,
    NotificationListener,
    { provide: PUSH_SENDER, useClass: WebPushSender },
  ],
  exports: [NotificationsService, NotificationOutbox, NotificationPreferencesService, PushService],
})
export class NotificationsModule implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly notifications: Queue) {}

  /** Fixed scheduler ids: what stops a redeploy from stacking a second sweep of either kind. */
  async onModuleInit(): Promise<void> {
    await this.notifications.upsertJobScheduler(
      NOTIFICATION_JOBS.SWEEP,
      { every: NOTIFICATION_SWEEP_EVERY_MS },
      { name: NOTIFICATION_JOBS.SWEEP },
    );
    await this.notifications.upsertJobScheduler(
      NOTIFICATION_JOBS.TESTS_OPENED,
      { every: TESTS_OPENED_SWEEP_EVERY_MS },
      { name: NOTIFICATION_JOBS.TESTS_OPENED },
    );
  }
}
