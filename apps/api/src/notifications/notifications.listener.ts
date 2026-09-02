import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ActorTypes, NOTIFICATION_TYPE } from '@iace/contracts';
import {
  DOMAIN_EVENTS,
  type ScoringCompletedEvent,
  type SeriesGrantedEvent,
  type SeriesUnlockedEvent,
  type StudentEnrolmentAddedEvent,
} from '../common/events/event-catalog';
import {
  MESSAGE_CHANNELS,
  MESSAGE_KINDS,
  MESSAGE_SENDER,
  type MessageSender,
} from '../common/messaging';
import { NotificationsService } from './notifications.service';

/**
 * Notifications are a reaction, never part of the write that caused them (docs/03 §4 rule 3), so
 * every handler swallows its own failure: nobody loses an unlock because a row could not be told.
 */
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    @Inject(MESSAGE_SENDER) private readonly sender: MessageSender,
  ) {}

  /** The bell always; the SMS only once a DLT template for it exists, which is a config change. */
  @OnEvent(DOMAIN_EVENTS.SCORING_COMPLETED)
  async onScoringCompleted(event: ScoringCompletedEvent): Promise<void> {
    try {
      await this.notifications.create({
        studentId: event.studentId,
        type: NOTIFICATION_TYPE.RESULT_READY,
        title: 'Your result is ready',
        body: 'Open the test to see your score, rank and answers.',
        testId: event.testId,
      });
    } catch (error) {
      this.logger.error(`Result notification failed for student ${event.studentId}`, error);
    }

    await this.text(event);
  }

  /** A number we cannot reach is not a reason to have failed the scoring that got here. */
  private async text(event: ScoringCompletedEvent): Promise<void> {
    try {
      const mobile = await this.notifications.mobileOf(event.studentId);
      if (!mobile) return;

      await this.sender.send({
        channel: MESSAGE_CHANNELS.SMS,
        kind: MESSAGE_KINDS.RESULT_READY,
        to: mobile,
        actor: ActorTypes.STUDENT,
        body: 'Your IACE test result is ready. Sign in to see your score and rank.',
        data: { testId: event.testId },
      });
    } catch (error) {
      this.logger.error(`Result SMS failed for student ${event.studentId}`, error);
    }
  }

  @OnEvent(DOMAIN_EVENTS.SERIES_UNLOCKED)
  async onSeriesUnlocked(event: SeriesUnlockedEvent): Promise<void> {
    try {
      await this.notifications.create({
        studentId: event.studentId,
        type: NOTIFICATION_TYPE.SERIES_UNLOCKED,
        title: 'A test series is now open',
        body: 'You can start its tests whenever you are ready.',
        testSeriesId: event.testSeriesId,
      });
    } catch (error) {
      this.logger.error(`Unlock notification failed for student ${event.studentId}`, error);
    }
  }

  @OnEvent(DOMAIN_EVENTS.STUDENT_ENROLMENT_ADDED)
  async onEnrolmentAdded(event: StudentEnrolmentAddedEvent): Promise<void> {
    try {
      // No deep link: an enrolment opens whatever the exam reaches, which is not one series.
      await this.notifications.create({
        studentId: event.studentId,
        type: NOTIFICATION_TYPE.ENROLLMENT_ADDED,
        title: 'You have been enrolled in a new exam',
        body: `Added: ${event.examCodes.join(', ')}.`,
      });
    } catch (error) {
      this.logger.error(`Enrolment notification failed for student ${event.studentId}`, error);
    }
  }

  @OnEvent(DOMAIN_EVENTS.SERIES_GRANTED)
  async onSeriesGranted(event: SeriesGrantedEvent): Promise<void> {
    try {
      await this.notifications.create({
        studentId: event.studentId,
        type: NOTIFICATION_TYPE.GRANT_ADDED,
        title: 'A test series was added to your account',
        body: 'Your institute has given you access to it.',
        testSeriesId: event.testSeriesId,
      });
    } catch (error) {
      this.logger.error(`Grant notification failed for student ${event.studentId}`, error);
    }
  }
}
