/**
 * The fact auth already announces and nobody was telling the student about. It is a REACTION: the
 * account is committed before this runs, so a notification that will not write must never cost
 * somebody their sign-in — the handler swallows its own failure.
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NOTIFICATION_TYPE } from '@iace/contracts';
import { DOMAIN_EVENTS, type StudentSignedUpEvent } from '../common/events';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService, type NewNotification } from './notifications.service';

@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @OnEvent(DOMAIN_EVENTS.STUDENT_SIGNED_UP)
  async onSignedUp(event: StudentSignedUpEvent): Promise<void> {
    await this.tell({
      studentId: event.studentId,
      type: NOTIFICATION_TYPE.WELCOME,
      title: 'Welcome to IACE',
      body: 'Your tests appear here as they open. Complete your profile before your first one.',
      dedupeKey: `welcome:${event.studentId}`,
    });
  }

  /** No transaction to join: the fact has already committed, so the bell row is its own write. */
  private async tell(intent: NewNotification): Promise<void> {
    try {
      await this.notifications.tell(this.prisma, intent);
    } catch (error) {
      this.logger.error(`Student ${intent.studentId} was not told: ${intent.type}`, error);
    }
  }
}
