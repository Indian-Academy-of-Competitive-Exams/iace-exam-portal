import { Module, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { NOTIFICATION_JOBS, NOTIFICATION_SWEEP_EVERY_MS, QUEUE_NAMES } from '../queue/queues';
import { NotificationsService } from './notifications.service';
import { NotificationOutbox } from './notification-outbox';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationDeliveryProcessor } from './notification-delivery.processor';

/** Owns `Notification` and `NotificationDelivery`. No controller: a student's bell hangs off `me`. */
@Module({
  imports: [PrismaModule, QueueModule],
  providers: [
    NotificationsService,
    NotificationOutbox,
    NotificationsProcessor,
    NotificationDeliveryProcessor,
  ],
  exports: [NotificationsService, NotificationOutbox],
})
export class NotificationsModule implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly notifications: Queue) {}

  /** Fixed scheduler id: what stops a redeploy from stacking a second sweep. */
  async onModuleInit(): Promise<void> {
    await this.notifications.upsertJobScheduler(
      NOTIFICATION_JOBS.SWEEP,
      { every: NOTIFICATION_SWEEP_EVERY_MS },
      { name: NOTIFICATION_JOBS.SWEEP },
    );
  }
}
