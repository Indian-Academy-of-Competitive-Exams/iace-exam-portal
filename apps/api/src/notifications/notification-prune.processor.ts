/**
 * A delivery is a ledger row, not a buffer: `statsOf` counts these to show an announcement's sent,
 * failed and skipped, and `exportDeliveries` builds its workbook from them. So the window is long
 * and it is named on the screen — past it an announcement reports zeros, which the Alert explains.
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job } from 'bullmq';
import { DeliveryStatus } from '@prisma/client';
import { DELIVERY_RETENTION_DAYS } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES, QUEUE_POLICY } from '../queue/queues';
import { QueueFailures } from '../common/metrics/queue-failures';

/** Every status but PENDING: a send that has been decided is what the window is measured against. */
const SETTLED: DeliveryStatus[] = [
  DeliveryStatus.SENT,
  DeliveryStatus.DELIVERED,
  DeliveryStatus.FAILED,
  DeliveryStatus.SKIPPED,
];

/** Deleted a page at a time, so one run never holds a lock the size of the backlog. */
export const DELIVERY_PRUNE_PAGE = 1000;

/** Caps one run, so a first prune of a neglected table is several nights rather than an outage. */
export const DELIVERY_PRUNE_MAX_PAGES = 100;

@Injectable()
@Processor(QUEUE_NAMES.NOTIFICATION_PRUNE, {
  concurrency: QUEUE_POLICY[QUEUE_NAMES.NOTIFICATION_PRUNE].concurrency,
})
export class NotificationPruneProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationPruneProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly failures: QueueFailures,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.failures.record(QUEUE_NAMES.NOTIFICATION_PRUNE, job, error);
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.failures.connectionError(QUEUE_NAMES.NOTIFICATION_PRUNE, error);
  }

  async process(): Promise<void> {
    const removed = await this.prune(new Date());
    if (removed > 0) this.logger.log(`Pruned ${removed} settled deliveries`);
  }

  /** Settled only: a PENDING row is a send still owed a decision, whatever its age. */
  async prune(now: Date, maxPages: number = DELIVERY_PRUNE_MAX_PAGES): Promise<number> {
    const queuedBefore = new Date(now.getTime() - DELIVERY_RETENTION_DAYS * MILLISECONDS_PER_DAY);
    const stale = {
      status: { in: SETTLED },
      queuedAt: { lt: queuedBefore },
    };
    let removed = 0;

    for (let page = 0; page < maxPages; page += 1) {
      const rows = await this.prisma.notificationDelivery.findMany({
        where: stale,
        orderBy: { queuedAt: 'asc' },
        take: DELIVERY_PRUNE_PAGE,
        select: { id: true },
      });
      if (rows.length === 0) return removed;

      const gone = await this.prisma.notificationDelivery.deleteMany({
        where: { id: { in: rows.map((row) => row.id) } },
      });
      removed += gone.count;
      if (rows.length < DELIVERY_PRUNE_PAGE) return removed;
    }

    this.logger.warn(`Stopped after ${maxPages} pages of pruning; the next run carries on`);
    return removed;
  }
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
