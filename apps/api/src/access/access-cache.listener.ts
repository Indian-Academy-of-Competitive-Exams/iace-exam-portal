import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS, type AccessCatalogChangedEvent } from '../common/events/event-catalog';
import { AccessResolverService } from './access-resolver.service';

@Injectable()
export class AccessCacheListener {
  private readonly logger = new Logger(AccessCacheListener.name);

  constructor(private readonly resolver: AccessResolverService) {}

  @OnEvent(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED)
  async onCatalogChanged(event: AccessCatalogChangedEvent): Promise<void> {
    try {
      await this.resolver.invalidateAll();
    } catch (error) {
      // The write already happened, and every held copy ages out on its own. Losing the bump must not fail the request that made the change.
      this.logger.error(`Catalog bump failed for series ${event.testSeriesId}`, error);
    }
  }
}
