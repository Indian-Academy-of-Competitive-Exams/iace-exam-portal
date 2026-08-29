import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
import { PrismaModule } from '../../prisma/prisma.module';
import { QueueModule } from '../../queue/queue.module';
import { OUTBOX_PRUNE_CRON, QUEUE_NAMES } from '../../queue/queues';
import { DomainEventBus } from './domain-event-bus';
import { OutboxPruneProcessor } from './outbox-prune.processor';

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
    PrismaModule,
    QueueModule,
  ],
  providers: [DomainEventBus, OutboxPruneProcessor],
  exports: [DomainEventBus],
})
export class EventsModule implements OnModuleInit {
  constructor(@InjectQueue(QUEUE_NAMES.OUTBOX_PRUNE) private readonly pruneQueue: Queue) {}

  /** Fixed scheduler id: what stops a redeploy from stacking a second nightly prune. */
  async onModuleInit(): Promise<void> {
    await this.pruneQueue.upsertJobScheduler(QUEUE_NAMES.OUTBOX_PRUNE, {
      pattern: OUTBOX_PRUNE_CRON,
      tz: 'UTC',
    });
  }
}
