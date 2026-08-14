import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DomainEventBus } from './domain-event-bus';

/**
 * Infrastructure, not a bounded context — like `prisma` and `redis`, every
 * service links it and none of them become it (docs/03 §4.4). `@Global()` for
 * the same reason those are: a module that emits an event should not have to
 * import a bus to do it, any more than it imports a logger.
 *
 * `forRoot()` runs once however many modules import this — Nest instantiates a
 * module class exactly once per application.
 */
@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot({
      // The catalog uses dotted names (`student.pin_reset`), and without this
      // EventEmitter2 reads the dot as a namespace separator — `attempt.*`
      // would then match, which is not a subscription anyone here wants by
      // accident. Names are opaque strings from the catalog and nothing else.
      wildcard: false,
      delimiter: '.',
    }),
  ],
  providers: [DomainEventBus],
  exports: [DomainEventBus],
})
export class EventsModule {}
