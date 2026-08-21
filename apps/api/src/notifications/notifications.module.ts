import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsListener } from './notifications.listener';
import { NotificationsService } from './notifications.service';

/** Owns `Notification`. No controller of its own: a student's bell hangs off `me`. */
@Module({
  imports: [PrismaModule],
  providers: [NotificationsService, NotificationsListener],
  exports: [NotificationsService],
})
export class NotificationsModule {}
