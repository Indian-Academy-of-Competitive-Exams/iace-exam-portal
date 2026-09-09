/**
 * The two facts auth already announces and nobody was telling the student about. Both are
 * REACTIONS: the account and the PIN are committed before this runs, so a notification that will
 * not write must never cost somebody their sign-in — every handler here swallows its own failure.
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NOTIFICATION_TYPE } from '@iace/contracts';
import {
  DOMAIN_EVENTS,
  PIN_RESET_REASONS,
  type StudentPinResetEvent,
  type StudentSignedUpEvent,
} from '../common/events';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationOutbox, type NotificationIntent } from './notification-outbox';

@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: NotificationOutbox,
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

  /** Told either way: a student cannot spot the change they did not make without seeing both. */
  @OnEvent(DOMAIN_EVENTS.STUDENT_PIN_RESET)
  async onPinReset(event: StudentPinResetEvent): Promise<void> {
    const forgotten = event.reason === PIN_RESET_REASONS.OTP_RESET;

    await this.tell({
      studentId: event.studentId,
      type: NOTIFICATION_TYPE.PIN_CHANGED,
      title: 'Your PIN was changed',
      body: forgotten
        ? 'It was reset with a code sent to your mobile. If that was not you, tell your branch office.'
        : 'You changed it while signed in. If that was not you, tell your branch office.',
    });
  }

  /** No transaction to join: the fact has already committed, so the outbox row is its own write. */
  private async tell(intent: NotificationIntent): Promise<void> {
    try {
      await this.outbox.request(this.prisma, intent);
    } catch (error) {
      this.logger.error(`Student ${intent.studentId} was not told: ${intent.type}`, error);
    }
  }
}
