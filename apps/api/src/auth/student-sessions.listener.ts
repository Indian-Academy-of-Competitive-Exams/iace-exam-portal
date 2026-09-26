import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ActorTypes } from '@iace/contracts';
import { DOMAIN_EVENTS, type StudentDeactivatedEvent } from '../common/events/event-catalog';
import { SessionService } from './session.service';

/** Deactivation must not wait out the access token: the flag lands, the sessions go. */
@Injectable()
export class StudentSessionsListener {
  private readonly logger = new Logger(StudentSessionsListener.name);

  constructor(private readonly sessions: SessionService) {}

  @OnEvent(DOMAIN_EVENTS.STUDENT_DEACTIVATED)
  async onStudentDeactivated(event: StudentDeactivatedEvent): Promise<void> {
    try {
      await this.sessions.revokeAll(ActorTypes.STUDENT, event.studentId);
    } catch (error) {
      // The flag is already saved and refresh re-reads it; losing the revocation must not fail the request.
      this.logger.error(`Session revocation failed for student ${event.studentId}`, error);
    }
  }
}
