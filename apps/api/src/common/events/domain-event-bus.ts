import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { type DomainEventName, type DomainEventPayloads } from './event-catalog';

/**
 * The in-process event bus, typed against the catalog. FIRE AND FORGET: a producer
 * publishes a fact that already happened, so a failing listener must not fail the request.
 */
@Injectable()
export class DomainEventBus {
  private readonly logger = new Logger(DomainEventBus.name);

  constructor(private readonly emitter: EventEmitter2) {}

  emit<K extends DomainEventName>(event: K, payload: DomainEventPayloads[K]): void {
    try {
      this.emitter.emit(event, payload);
    } catch (error) {
      this.logger.error(`Listener for "${event}" threw; the producer is unaffected.`, error);
    }
  }
}
