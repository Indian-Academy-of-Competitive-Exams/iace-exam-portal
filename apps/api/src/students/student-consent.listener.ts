import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS, type StudentSignedUpEvent } from '../common/events';
import { StudentPrivacyService } from './student-privacy.service';

/** Consent is a REACTION to signing up, so a record that will not write never costs an account. */
@Injectable()
export class StudentConsentListener {
  private readonly logger = new Logger(StudentConsentListener.name);

  constructor(private readonly privacy: StudentPrivacyService) {}

  @OnEvent(DOMAIN_EVENTS.STUDENT_SIGNED_UP)
  async onSignedUp(event: StudentSignedUpEvent): Promise<void> {
    try {
      await this.privacy.recordAtSignup(event.studentId);
    } catch (error) {
      this.logger.error(`Consent not recorded for student ${event.studentId}`, error);
    }
  }
}
