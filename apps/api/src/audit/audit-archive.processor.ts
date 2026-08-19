import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { AppException, ErrorCodes } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { QUEUE_NAMES } from '../queue/queues';
import { AUDIT_RETENTION_DAYS, archiveKeyFor, dayToArchive, toNdjson } from './audit-archive';

/** Caps one run's catch-up so a long outage logs a warning instead of running forever. */
export const AUDIT_ARCHIVE_MAX_DAYS_PER_RUN = 14;

/** Rows read and compressed per page, so one day never sits in memory as a single array. */
export const AUDIT_ARCHIVE_PAGE_SIZE = 1000;

interface PendingDay {
  gte: Date;
  lt: Date;
  eligibleBefore: Date;
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

@Injectable()
@Processor(QUEUE_NAMES.AUDIT_ARCHIVE)
export class AuditArchiveProcessor extends WorkerHost {
  private readonly logger = new Logger(AuditArchiveProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(): Promise<void> {
    await this.archivePendingDays(new Date());
  }

  /**
   * Repeats `archiveOneDay` until the backlog clears or the bound is hit, so a run BullMQ never
   * got to — retries exhausted, the worker down at 02:30 — is a delay, never a stranded day.
   */
  async archivePendingDays(
    now: Date,
    maxDays: number = AUDIT_ARCHIVE_MAX_DAYS_PER_RUN,
  ): Promise<{ key: string; rows: number }[]> {
    const archived: { key: string; rows: number }[] = [];
    while (archived.length < maxDays) {
      let result: { key: string; rows: number } | null;
      try {
        result = await this.archiveOneDay(now);
      } catch (error) {
        this.logger.error(
          `Audit archive failed after archiving ${archived.length} day(s) this run: ` +
            (error instanceof Error ? error.message : String(error)),
        );
        throw new AppException(
          ErrorCodes.INTERNAL,
          `Audit archive run failed partway through its backlog, after ${archived.length} day(s)`,
          { cause: error, details: { archived } },
        );
      }
      if (!result) return archived;
      archived.push(result);
    }

    if (await this.oldestPendingDay(now)) {
      this.logger.warn(
        `Audit archive hit its ${maxDays}-day bound; backlog remains for the next run`,
      );
    }
    return archived;
  }

  /** The oldest day still owed an archive — never just "yesterday's boundary" — or null if none. */
  async archiveOneDay(now: Date): Promise<{ key: string; rows: number } | null> {
    const day = await this.oldestPendingDay(now);
    if (!day) return null;
    return this.archiveWindow(day.gte, day.lt, day.eligibleBefore);
  }

  private async oldestPendingDay(now: Date): Promise<PendingDay | null> {
    const eligibleBefore = addUtcDays(dayToArchive(now, AUDIT_RETENTION_DAYS), 1);
    const [oldest] = await this.prisma.rowActionLog.findMany({
      where: { createdAt: { lt: eligibleBefore } },
      orderBy: { createdAt: 'asc' },
      take: 1,
    });
    if (!oldest) return null;

    const gte = new Date(oldest.createdAt as Date);
    gte.setUTCHours(0, 0, 0, 0);
    return { gte, lt: addUtcDays(gte, 1), eligibleBefore };
  }

  /**
   * Select, write, verify, and only then delete — the identical [gte, lt) window on every end.
   * Public so the boundary is testable on its own; `assertWindow` is what keeps that safe.
   */
  async archiveWindow(
    gte: Date,
    lt: Date,
    eligibleBefore: Date,
  ): Promise<{ key: string; rows: number } | null> {
    this.assertWindow(gte, lt, eligibleBefore);

    const key = archiveKeyFor(gte);
    const pages: Buffer[] = [];
    let rowCount = 0;
    let cursor: string | undefined;

    for (;;) {
      const page = await this.prisma.rowActionLog.findMany({
        where: { createdAt: { gte, lt }, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: 'asc' },
        take: AUDIT_ARCHIVE_PAGE_SIZE,
      });
      if (page.length === 0) break;
      pages.push(toNdjson(page));
      rowCount += page.length;

      const last = page.at(-1);
      if (!last) break;
      cursor = last.id;
      if (page.length < AUDIT_ARCHIVE_PAGE_SIZE) break;
    }
    if (rowCount === 0) return null;

    const body = Buffer.concat(pages);
    await this.storage.upload(key, body, 'application/gzip');

    const size = await this.storage.objectSize(key);
    if (size !== body.byteLength) {
      throw new AppException(
        ErrorCodes.INTERNAL,
        `Archive ${key} verified as ${size ?? 'missing'}, expected ${body.byteLength}`,
      );
    }

    await this.prisma.rowActionLog.deleteMany({ where: { createdAt: { gte, lt } } });
    this.logger.log(`Archived ${rowCount} audit rows to ${key}`);
    return { key, rows: rowCount };
  }

  /** The three things that make deleting by `[gte, lt)` safe, checked independent of the caller. */
  private assertWindow(gte: Date, lt: Date, eligibleBefore: Date): void {
    const isUtcMidnight =
      gte.getUTCHours() === 0 &&
      gte.getUTCMinutes() === 0 &&
      gte.getUTCSeconds() === 0 &&
      gte.getUTCMilliseconds() === 0;
    if (!isUtcMidnight) {
      throw new AppException(
        ErrorCodes.VALIDATION_ERROR,
        `Archive window must start at UTC midnight, got ${gte.toISOString()}`,
      );
    }
    if (lt.getTime() !== addUtcDays(gte, 1).getTime()) {
      throw new AppException(
        ErrorCodes.VALIDATION_ERROR,
        `Archive window must span exactly one UTC day: ${gte.toISOString()} to ${lt.toISOString()}`,
      );
    }
    if (lt.getTime() > eligibleBefore.getTime()) {
      throw new AppException(
        ErrorCodes.VALIDATION_ERROR,
        `Archive window ending ${lt.toISOString()} reaches past the retention boundary ${eligibleBefore.toISOString()}`,
      );
    }
  }
}
