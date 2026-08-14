import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { type DomainEventName, type DomainEventPayloads } from './event-catalog';

/**
 * The in-process event bus, typed against the catalog.
 *
 * FIRE AND FORGET, deliberately. A producer publishes a fact that has already
 * happened — the PIN *is* reset, the attempt *is* submitted — so a listener
 * that fails must not turn a completed operation into a failed request. The
 * catch below is what guarantees that: without it, EventEmitter2 propagates a
 * synchronous listener error straight back into the caller's stack, and a
 * broken notification handler would start failing PIN resets.
 *
 * That also fixes the delivery guarantee at "best effort in this process". When
 * a reaction has to survive a crash or a redeploy — scoring, above all — the
 * answer is a BullMQ job, not this (docs/03 §6). This is for reactions where
 * losing one is a missed notification, not a missing result.
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
