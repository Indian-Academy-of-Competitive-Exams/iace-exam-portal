import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { type RowActionLog } from '@prisma/client';
import { AppException, ErrorCodes } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { redisKeys } from '../redis/redis.keys';
import { StorageService } from '../storage/storage.service';
import { QUEUE_NAMES } from '../queue/queues';
import { AuditService } from './audit.service';
import { AUDIT_RETENTION_DAYS, archiveKeyFor, dayToArchive, toNdjson } from './audit-archive';
import {
  instituteDayOf,
  shiftInstituteDay,
  startOfInstituteDay,
} from '../common/time/institute-day';

/** Caps one run's catch-up so a long outage logs a warning instead of running forever. */
export const AUDIT_ARCHIVE_MAX_DAYS_PER_RUN = 14;

/** Rows read and compressed per page, so one day never sits in memory as a single array. */
export const AUDIT_ARCHIVE_PAGE_SIZE = 1000;

/** Long enough to page and upload the largest realistic day; the lock is the only thing between
 *  two workers on one day, and BullMQ's job lock expires on a stall. */
export const AUDIT_ARCHIVE_LOCK_TTL_SEC = 900;

interface PendingDay {
  gte: Date;
  lt: Date;
  eligibleBefore: Date;
}

/** The day after an institute midnight, which is the exclusive end of that day's window. */
function nextInstituteMidnight(from: Date): Date {
  return startOfInstituteDay(shiftInstituteDay(instituteDayOf(from), 1));
}

@Injectable()
@Processor(QUEUE_NAMES.AUDIT_ARCHIVE)
export class AuditArchiveProcessor extends WorkerHost {
  private readonly logger = new Logger(AuditArchiveProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
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
    const eligibleBefore = nextInstituteMidnight(dayToArchive(now, AUDIT_RETENTION_DAYS));
    const [oldest] = await this.prisma.rowActionLog.findMany({
      where: { createdAt: { lt: eligibleBefore } },
      orderBy: { createdAt: 'asc' },
      take: 1,
    });
    if (!oldest) return null;

    const gte = startOfInstituteDay(instituteDayOf(oldest.createdAt as Date));
    return { gte, lt: nextInstituteMidnight(gte), eligibleBefore };
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

    // Without this, a second worker's page read can land after the first one's delete: it uploads
    // its short body over the complete object, verifies against itself, and the rest is gone.
    const lock = redisKeys.auditArchiveDay(instituteDayOf(gte));
    if (!(await this.redis.acquireLock(lock, AUDIT_ARCHIVE_LOCK_TTL_SEC))) {
      this.logger.warn(`Another worker holds ${lock}; leaving that day for the next run`);
      return null;
    }

    try {
      return await this.writeAndDrop(gte, lt);
    } finally {
      await this.redis.del(lock);
    }
  }

  private async writeAndDrop(gte: Date, lt: Date): Promise<{ key: string; rows: number } | null> {
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
      pages.push(toNdjson(await this.withActorNames(page)));
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

  /** Resolved here, not at read time: an archive that needs a live database to say who did
   *  something is not an archive. */
  private async withActorNames(page: readonly RowActionLog[]): Promise<object[]> {
    const names = await this.audit.namesFor(page);
    return page.map((row) => ({
      ...row,
      actorName: row.actorId ? (names.get(row.actorId) ?? null) : null,
    }));
  }

  /** The three things that make deleting by `[gte, lt)` safe, checked independent of the caller. */
  private assertWindow(gte: Date, lt: Date, eligibleBefore: Date): void {
    if (gte.getTime() !== startOfInstituteDay(instituteDayOf(gte)).getTime()) {
      throw new AppException(
        ErrorCodes.VALIDATION_ERROR,
        `Archive window must start at institute midnight, got ${gte.toISOString()}`,
      );
    }
    if (lt.getTime() !== nextInstituteMidnight(gte).getTime()) {
      throw new AppException(
        ErrorCodes.VALIDATION_ERROR,
        `Archive window must span exactly one institute day: ${gte.toISOString()} to ${lt.toISOString()}`,
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
