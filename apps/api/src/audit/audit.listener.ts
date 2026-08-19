import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS, type AuditRowActionEvent } from '../common/events/event-catalog';
import { AuditService } from './audit.service';

@Injectable()
export class AuditListener {
  private readonly logger = new Logger(AuditListener.name);

  constructor(private readonly audit: AuditService) {}

  @OnEvent(DOMAIN_EVENTS.AUDIT_ROW_ACTION)
  async onRowAction(event: AuditRowActionEvent): Promise<void> {
    try {
      await this.audit.record(event);
    } catch (error) {
      // The write already happened. Losing its record must not undo it.
      this.logger.error(`Audit write failed for ${event.feature}/${event.entityId}`, error);
    }
  }
}
