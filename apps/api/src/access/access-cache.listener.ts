import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DOMAIN_EVENTS,
  type AccessCatalogChangedEvent,
  type ExamStageChangedEvent,
} from '../common/events/event-catalog';
import { AccessResolverService } from './access-resolver.service';

@Injectable()
export class AccessCacheListener {
  private readonly logger = new Logger(AccessCacheListener.name);

  constructor(private readonly resolver: AccessResolverService) {}

  @OnEvent(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED)
  onCatalogChanged(event: AccessCatalogChangedEvent): Promise<void> {
    return this.bump(`series ${event.testSeriesId}`);
  }

  @OnEvent(DOMAIN_EVENTS.EXAM_STAGE_CHANGED)
  onExamStageChanged(event: ExamStageChangedEvent): Promise<void> {
    return this.bump(`stage ${event.examStageId}`);
  }

  private async bump(what: string): Promise<void> {
    try {
      await this.resolver.invalidateAll();
    } catch (error) {
      // The write already happened, and every held copy ages out on its own. Losing the bump must not fail the request that made the change.
      this.logger.error(`Catalog bump failed for ${what}`, error);
    }
  }
}
