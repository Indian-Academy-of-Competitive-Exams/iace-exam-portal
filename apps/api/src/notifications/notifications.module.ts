import { forwardRef, Module, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { type AccessModule } from '../access';
import { QueueModule } from '../queue/queue.module';
import {
  NOTIFICATION_JOBS,
  NOTIFICATION_PRUNE_CRON,
  NOTIFICATION_SWEEP_EVERY_MS,
  QUEUE_NAMES,
  TESTS_OPENED_SWEEP_EVERY_MS,
} from '../queue/queues';
import { NotificationsService } from './notifications.service';
import { NotificationOutbox } from './notification-outbox';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationDeliveryProcessor } from './notification-delivery.processor';
import { NotificationPruneProcessor } from './notification-prune.processor';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementsController } from './announcements.controller';
import { FcmSender } from './fcm.sender';
import { PushService } from './push.service';
import { TestOpeningService } from './test-opening.service';
import { NotificationListener } from './notification.listener';
import { WebPushSender } from './web-push.sender';
import { API_ROLES, onRole, servesRole } from '../config/api-role';

/** Owns the ledger and the push endpoints. No controller of its own: both hang off `me`. */
@Module({
  imports: [
    PrismaModule,
    QueueModule,
    // `require`, not a static import: `access` imports this barrel back and would re-enter it.
    forwardRef(
      () => (module.require('../access') as { AccessModule: typeof AccessModule }).AccessModule,
    ),
  ],
  controllers: onRole([API_ROLES.CORE], [AnnouncementsController]),
  providers: [
    AnnouncementsService,
    NotificationsService,
    NotificationOutbox,
    ...onRole(
      [API_ROLES.WORKER],
      [NotificationsProcessor, NotificationDeliveryProcessor, NotificationPruneProcessor],
    ),
    PushService,
    FcmSender,
    TestOpeningService,
    NotificationListener,
    WebPushSender,
  ],
  exports: [NotificationsService, NotificationOutbox, PushService],
})
export class NotificationsModule implements OnModuleInit {
  constructor(
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly notifications: Queue,
    @InjectQueue(QUEUE_NAMES.NOTIFICATION_PRUNE) private readonly pruneQueue: Queue,
  ) {}

  /** Fixed scheduler ids: what stops a redeploy from stacking a second sweep of either kind. */
  async onModuleInit(): Promise<void> {
    // The container that runs the jobs is the one that schedules them.
    if (!servesRole(API_ROLES.WORKER)) return;

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
    await this.pruneQueue.upsertJobScheduler(QUEUE_NAMES.NOTIFICATION_PRUNE, {
      pattern: NOTIFICATION_PRUNE_CRON,
      tz: 'UTC',
    });
  }
}
