import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DomainEventBus } from './domain-event-bus';

/**
 * Infrastructure, not a bounded context — like `prisma` and `redis`, every service links it and
 * none of them become it (docs/03 §4.4).
 */
@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot({
      // The catalog uses dotted names (`student.pin_reset`), and without this EventEmitter2 reads the
      // dot as a namespace separator — `attempt.*` would then match, which is not a subscription anyone
      // here wants by accident.
      wildcard: false,
      delimiter: '.',
    }),
  ],
  providers: [DomainEventBus],
  exports: [DomainEventBus],
})
export class EventsModule {}
