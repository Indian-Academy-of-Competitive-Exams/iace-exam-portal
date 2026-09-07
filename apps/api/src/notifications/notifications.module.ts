import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';
import { NotificationOutbox } from './notification-outbox';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationDeliveryProcessor } from './notification-delivery.processor';

/** Owns `Notification` and `NotificationDelivery`. No controller: a student's bell hangs off `me`. */
@Module({
  imports: [PrismaModule, QueueModule],
  providers: [
    NotificationsService,
    NotificationsListener,
    NotificationOutbox,
    NotificationsProcessor,
    NotificationDeliveryProcessor,
  ],
  exports: [NotificationsService, NotificationOutbox],
})
export class NotificationsModule {}
