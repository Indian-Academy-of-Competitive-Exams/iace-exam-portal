import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ActorTypes } from '@iace/contracts';
import {
  DOMAIN_EVENTS,
  type StudentDeactivatedEvent,
  type StudentMobileChangedEvent,
} from '../common/events/event-catalog';
import { SessionService } from './session.service';

/** Neither a deactivation nor a new number waits out the access token: the write lands, the sessions go. */
@Injectable()
export class StudentSessionsListener {
  private readonly logger = new Logger(StudentSessionsListener.name);

  constructor(private readonly sessions: SessionService) {}

  @OnEvent(DOMAIN_EVENTS.STUDENT_DEACTIVATED)
  onStudentDeactivated(event: StudentDeactivatedEvent): Promise<void> {
    return this.signOut(event.studentId);
  }

  @OnEvent(DOMAIN_EVENTS.STUDENT_MOBILE_CHANGED)
  onStudentMobileChanged(event: StudentMobileChangedEvent): Promise<void> {
    return this.signOut(event.studentId);
  }

  private async signOut(studentId: string): Promise<void> {
    try {
      await this.sessions.revokeAll(ActorTypes.STUDENT, studentId);
    } catch (error) {
      // The write is already saved; losing the revocation must not fail the request that made it.
      this.logger.error(`Session revocation failed for student ${studentId}`, error);
    }
  }
}
