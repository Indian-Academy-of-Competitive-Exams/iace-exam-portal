import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DOMAIN_EVENTS,
  type AccessCatalogChangedEvent,
  type StudentAccessChangedEvent,
} from '../common/events/event-catalog';
import { AccessResolverService } from './access-resolver.service';

@Injectable()
export class AccessCacheListener {
  private readonly logger = new Logger(AccessCacheListener.name);

  constructor(private readonly resolver: AccessResolverService) {}

  @OnEvent(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED)
  async onStudentAccessChanged(event: StudentAccessChangedEvent): Promise<void> {
    try {
      await this.resolver.invalidateStudent(event.studentId);
    } catch (error) {
      // The write already happened, and the entry expires on its own. Losing the bust
      // must not fail the request that made the change.
      this.logger.error(`Catalog bust failed for student ${event.studentId}`, error);
    }
  }

  @OnEvent(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED)
  async onCatalogChanged(event: AccessCatalogChangedEvent): Promise<void> {
    try {
      await this.resolver.invalidateAll();
    } catch (error) {
      this.logger.error(`Catalog bust failed for series ${event.testSeriesId}`, error);
    }
  }
}
