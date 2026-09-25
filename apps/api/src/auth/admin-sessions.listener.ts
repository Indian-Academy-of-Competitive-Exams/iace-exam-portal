import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ActorTypes } from '@iace/contracts';
import { DOMAIN_EVENTS, type AdminDeactivatedEvent } from '../common/events/event-catalog';
import { SessionService } from './session.service';

/** Deactivation must not wait out the access token: the flag lands, the sessions go. */
@Injectable()
export class AdminSessionsListener {
  private readonly logger = new Logger(AdminSessionsListener.name);

  constructor(private readonly sessions: SessionService) {}

  @OnEvent(DOMAIN_EVENTS.ADMIN_DEACTIVATED)
  async onAdminDeactivated(event: AdminDeactivatedEvent): Promise<void> {
    try {
      await this.sessions.revokeAll(ActorTypes.ADMIN, event.adminId);
    } catch (error) {
      // The flag is already saved and refresh re-reads it; losing the revocation must not fail the request.
      this.logger.error(`Session revocation failed for admin ${event.adminId}`, error);
    }
  }
}
