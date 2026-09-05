/**
 * OutboxEvent is a hand-off buffer, not a record. A row exists so that a state change and the
 * event announcing it commit together, and it has done its whole job the moment a relay hands
 * it on — the audit log is where history lives (docs/03 §5).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUE_NAMES, QUEUE_POLICY } from '../../queue/queues';

/** Long enough to answer "was this attempt's scoring ever asked for?" and no longer. */
export const OUTBOX_RETENTION_DAYS = 7;

/** Deleted a page at a time, so one run never holds a lock the size of the backlog. */
export const OUTBOX_PRUNE_PAGE = 1000;

/** Caps one run, so a first prune of a neglected table is several runs rather than an outage. */
export const OUTBOX_PRUNE_MAX_PAGES = 100;

@Injectable()
@Processor(QUEUE_NAMES.OUTBOX_PRUNE, {
  concurrency: QUEUE_POLICY[QUEUE_NAMES.OUTBOX_PRUNE].concurrency,
})
export class OutboxPruneProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboxPruneProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(): Promise<void> {
    const removed = await this.prune(new Date());
    if (removed > 0) this.logger.log(`Pruned ${removed} relayed events`);
  }

  /** Relayed rows only: a pending one is a scoring request nobody has handed on yet. */
  async prune(now: Date, maxPages: number = OUTBOX_PRUNE_MAX_PAGES): Promise<number> {
    const relayedBefore = new Date(now.getTime() - OUTBOX_RETENTION_DAYS * MILLISECONDS_PER_DAY);
    let removed = 0;

    for (let page = 0; page < maxPages; page += 1) {
      const stale = await this.prisma.outboxEvent.findMany({
        where: { processedAt: { not: null, lt: relayedBefore } },
        orderBy: { processedAt: 'asc' },
        take: OUTBOX_PRUNE_PAGE,
        select: { id: true },
      });
      if (stale.length === 0) return removed;

      const gone = await this.prisma.outboxEvent.deleteMany({
        where: { id: { in: stale.map((row) => row.id) } },
      });
      removed += gone.count;
      if (stale.length < OUTBOX_PRUNE_PAGE) return removed;
    }

    this.logger.warn(`Stopped after ${maxPages} pages of pruning; the next run carries on`);
    return removed;
  }
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
