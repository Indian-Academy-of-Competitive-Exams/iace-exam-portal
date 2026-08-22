import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes } from '@iace/contracts';
import { archiveKeyFor } from '../src/audit/audit-archive';
import {
  AUDIT_ARCHIVE_LOCK_TTL_SEC,
  AUDIT_ARCHIVE_PAGE_SIZE,
  AuditArchiveProcessor,
} from '../src/audit/audit-archive.processor';
import { AuditService } from '../src/audit/audit.service';
import { redisKeys } from '../src/redis/redis.keys';
import { FakePrisma, FakeRedis, FakeStorage, makeAdmin } from './support/fakes';
import { startOfInstituteDay } from '../src/common/time/institute-day';

const NOW = new Date('2026-04-10T02:00:00Z');
const OLD_DAY = new Date('2026-03-11T09:00:00Z');

function withRows(count: number) {
  const prisma = new FakePrisma();
  const storage = new FakeStorage();
  const redis = new FakeRedis();
  for (let index = 0; index < count; index += 1) {
    prisma.rowActionLogs.push({
      id: `ral_${index}`,
      createdAt: OLD_DAY,
      feature: 'STUDENT',
      entityId: `stu_${index}`,
      action: 'UPDATE',
      actorType: 'ADMIN',
      actorId: 'adm_1',
      changed: null,
      importLogId: null,
    });
  }
  return {
    prisma,
    storage,
    redis,
    job: new AuditArchiveProcessor(
      prisma as never,
      storage as never,
      redis.asService(),
      new AuditService(prisma.asService(), new FakeStorage() as never),
    ),
  };
}

describe('AuditArchiveProcessor', () => {
  it('writes the day to S3 and then deletes exactly that day', async () => {
    const { prisma, storage, job } = withRows(3);

    const result = await job.archiveOneDay(NOW);

    assert.equal(result?.rows, 3);
    assert.equal(result?.key, 'audit/row-actions/2026/03/11.ndjson.gz');
    assert.equal(
      gunzipSync(storage.objects.get(result!.key)!).toString('utf8').trim().split('\n').length,
      3,
    );
    assert.equal(prisma.rowActionLogs.length, 0);
  });

  /**
   * The failure this exists to prevent: rows deleted on the strength of an upload that never
   * landed. A failed write must leave every row where it was, for tomorrow's run.
   */
  it('deletes nothing when the upload throws', async () => {
    const { prisma, storage, job } = withRows(3);
    storage.failNextUpload = true;

    await assert.rejects(() => job.archiveOneDay(NOW));

    assert.equal(prisma.rowActionLogs.length, 3);
  });

  /** Same failure, quieter: the upload resolved but the object is not what was written. */
  it('deletes nothing when verification disagrees with what was written', async () => {
    const { prisma, storage, job } = withRows(3);
    storage.reportSize(archiveKeyFor(OLD_DAY), 0);

    await assert.rejects(() => job.archiveOneDay(NOW));

    assert.equal(prisma.rowActionLogs.length, 3);
  });

  it('writes no object and deletes nothing for a day with no rows', async () => {
    const { prisma, storage, job } = withRows(0);

    assert.equal(await job.archiveOneDay(NOW), null);
    assert.equal(storage.objects.size, 0);
    assert.equal(prisma.rowActionLogs.length, 0);
  });

  /** A replay after an outage must overwrite the same key and delete the same window. */
  it('is idempotent when the same day is run twice', async () => {
    const { prisma, job } = withRows(2);

    await job.archiveOneDay(NOW);
    assert.equal(await job.archiveOneDay(NOW), null);
    assert.equal(prisma.rowActionLogs.length, 0);
  });

  /** Rows inside the window are none of this run's business. */
  it('leaves rows newer than the retention boundary alone', async () => {
    const { prisma, job } = withRows(1);
    prisma.rowActionLogs.push({ id: 'ral_new', createdAt: new Date('2026-04-09T09:00:00Z') });

    await job.archiveOneDay(NOW);

    assert.deepEqual(
      prisma.rowActionLogs.map((row) => row.id),
      ['ral_new'],
    );
  });

  /**
   * The single most dangerous gap in this slice: with `gte` dropped from the delete, this row
   * — older than the window being archived, never selected, never uploaded — is destroyed
   * anyway. Pinned directly against `archiveWindow` so no day-selection logic can mask it.
   */
  it('deletes only the exact [gte, lt) window, not a row just outside either edge', async () => {
    const { prisma, job } = withRows(0);
    const gte = startOfInstituteDay('2026-03-11');
    const lt = startOfInstituteDay('2026-03-12');
    prisma.rowActionLogs.push(
      { id: 'ral_before', createdAt: new Date(gte.getTime() - 1) },
      { id: 'ral_in', createdAt: gte },
      { id: 'ral_after', createdAt: lt },
    );

    const result = await job.archiveWindow(gte, lt, lt);

    assert.equal(result?.rows, 1);
    assert.deepEqual(prisma.rowActionLogs.map((row) => row.id).sort(), ['ral_after', 'ral_before']);
  });

  /**
   * The failure this prevents: BullMQ locks a job, not a day, and stalled-job recovery exists
   * because those locks expire. Two workers on one day is one of them reading page 2 after the
   * other's deleteMany, uploading its short body over the complete object, and verifying it
   * against its own buffer — which passes. The rows in between are gone from Postgres and S3.
   */
  it('leaves a day alone while another worker holds it', async () => {
    const { prisma, storage, redis, job } = withRows(3);
    const held = await redis.acquireLock(
      redisKeys.auditArchiveDay('2026-03-11'),
      AUDIT_ARCHIVE_LOCK_TTL_SEC,
    );

    assert.equal(held, true);
    assert.equal(await job.archiveOneDay(NOW), null);
    assert.equal(prisma.rowActionLogs.length, 3);
    assert.equal(storage.objects.size, 0);
  });

  /** Released, not left to expire: the next day of the same backlog run has to be able to start. */
  it('frees the day it archived, so a following run is not locked out', async () => {
    const { redis, job } = withRows(3);

    await job.archiveOneDay(NOW);

    assert.equal(
      await redis.acquireLock(redisKeys.auditArchiveDay('2026-03-11'), AUDIT_ARCHIVE_LOCK_TTL_SEC),
      true,
    );
  });

  /** Released even when the day failed, or one bad upload locks that day out for 15 minutes. */
  it('frees the day when the upload throws', async () => {
    const { storage, redis, job } = withRows(3);
    storage.failNextUpload = true;

    await assert.rejects(() => job.archiveOneDay(NOW));

    assert.equal(
      await redis.acquireLock(redisKeys.auditArchiveDay('2026-03-11'), AUDIT_ARCHIVE_LOCK_TTL_SEC),
      true,
    );
  });

  /**
   * The failure this prevents: the archived object is the only surviving copy of these rows, and
   * bare cuids in it mean the one question it exists to answer — who did this — needs a database
   * that may not have the row, or may not exist, by the time anyone asks.
   */
  it('resolves actor names into the archive rather than leaving bare ids', async () => {
    const { prisma, storage, job } = withRows(2);
    prisma.admins.push(makeAdmin({ id: 'adm_1', fullName: 'R Kumar' }));

    const result = await job.archiveOneDay(NOW);

    const lines = gunzipSync(storage.objects.get(result!.key)!)
      .toString('utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { actorId: string; actorName: string });
    assert.deepEqual(
      lines.map((line) => line.actorName),
      ['R Kumar', 'R Kumar'],
    );
  });

  /**
   * `archiveWindow` is public so the boundary above is testable, but that means it can no
   * longer trust its only caller to hand it a sane window — it must refuse a bad one itself.
   */
  describe('archiveWindow refuses a window it cannot safely delete by', () => {
    function isValidationError(error: unknown): boolean {
      return error instanceof AppException && error.code === ErrorCodes.VALIDATION_ERROR;
    }

    it('rejects a gte that is not UTC midnight', async () => {
      const { job } = withRows(0);
      const gte = new Date('2026-03-11T00:00:01Z');
      const lt = new Date('2026-03-12T00:00:01Z');

      await assert.rejects(() => job.archiveWindow(gte, lt, lt), isValidationError);
    });

    it('rejects a window that does not span exactly one UTC day', async () => {
      const { job } = withRows(0);
      const gte = new Date('2026-03-11T00:00:00Z');
      const lt = new Date('2026-03-13T00:00:00Z');

      await assert.rejects(() => job.archiveWindow(gte, lt, lt), isValidationError);
    });

    it('rejects a window that reaches past the retention boundary', async () => {
      const { job } = withRows(0);
      const gte = new Date('2026-03-11T00:00:00Z');
      const lt = new Date('2026-03-12T00:00:00Z');
      const eligibleBefore = new Date('2026-03-11T00:00:00Z');

      await assert.rejects(() => job.archiveWindow(gte, lt, eligibleBefore), isValidationError);
    });
  });

  /**
   * Task 15 brief's original gap: a window derived only from `now` archives a different day
   * every calendar day, so a missed run stranded its day forever. Selection must instead walk
   * the backlog oldest-first until the table agrees there is nothing older left to archive.
   */
  it('clears a multi-day backlog in one run, oldest day first', async () => {
    const { prisma, job } = withRows(0);
    prisma.rowActionLogs.push(
      { id: 'ral_feb', createdAt: new Date('2026-02-01T09:00:00Z') },
      { id: 'ral_mar5', createdAt: new Date('2026-03-05T09:00:00Z') },
      { id: 'ral_mar11', createdAt: OLD_DAY },
    );

    const archived = await job.archivePendingDays(NOW);

    assert.deepEqual(
      archived.map((day) => day.key),
      [
        'audit/row-actions/2026/02/01.ndjson.gz',
        'audit/row-actions/2026/03/05.ndjson.gz',
        'audit/row-actions/2026/03/11.ndjson.gz',
      ],
    );
    assert.equal(prisma.rowActionLogs.length, 0);
  });

  /** A backlog longer than the bound is not silently truncated — the rest waits for next run. */
  it('stops at the day bound and leaves the remaining backlog untouched', async () => {
    const { prisma, job } = withRows(0);
    for (const day of ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']) {
      prisma.rowActionLogs.push({ id: `ral_${day}`, createdAt: new Date(`${day}T09:00:00Z`) });
    }

    const archived = await job.archivePendingDays(NOW, 2);

    assert.equal(archived.length, 2);
    assert.deepEqual(
      prisma.rowActionLogs.map((row) => row.id),
      ['ral_2026-01-03', 'ral_2026-01-04'],
    );
  });

  /** The bound was hit, but nothing was left behind — that is success, not a warning-worthy gap. */
  it('does not warn about backlog when the bound exactly clears it', async () => {
    const { prisma, job } = withRows(0);
    prisma.rowActionLogs.push(
      { id: 'ral_a', createdAt: new Date('2026-01-01T09:00:00Z') },
      { id: 'ral_b', createdAt: new Date('2026-01-02T09:00:00Z') },
    );
    const warnings: string[] = [];
    (job as unknown as { logger: { warn: (message: string) => void } }).logger.warn = (
      message: string,
    ) => warnings.push(message);

    const archived = await job.archivePendingDays(NOW, 2);

    assert.equal(archived.length, 2);
    assert.deepEqual(warnings, []);
  });

  /**
   * The whole point of the bounded loop: a failure on day 2 must not un-archive day 1, must not
   * touch day 3, and must not let the caller find out silently — the progress made so far has to
   * survive in what the failure itself reports.
   */
  it('preserves already-archived days when a later day in the backlog fails', async () => {
    const { prisma, storage, job } = withRows(0);
    const day1Gte = new Date('2026-01-01T00:00:00Z');
    const day2Gte = new Date('2026-01-02T00:00:00Z');
    prisma.rowActionLogs.push(
      { id: 'ral_day1', createdAt: new Date('2026-01-01T09:00:00Z') },
      { id: 'ral_day2', createdAt: new Date('2026-01-02T09:00:00Z') },
      { id: 'ral_day3', createdAt: new Date('2026-01-03T09:00:00Z') },
    );
    storage.reportSize(archiveKeyFor(day2Gte), 0);

    let caught: unknown;
    try {
      await job.archivePendingDays(NOW);
      assert.fail('expected archivePendingDays to reject');
    } catch (error) {
      caught = error;
    }

    assert.ok(caught instanceof AppException);
    const details = caught.details as { archived: { key: string }[] };
    assert.deepEqual(
      details.archived.map((day) => day.key),
      [archiveKeyFor(day1Gte)],
    );
    assert.deepEqual(
      prisma.rowActionLogs.map((row) => row.id),
      ['ral_day2', 'ral_day3'],
    );
  });

  /** A bulk-import day must not have to fit in memory as one array to be archived correctly. */
  it('archives a day with more rows than a single page holds', async () => {
    const total = AUDIT_ARCHIVE_PAGE_SIZE + 500;
    const { prisma, storage, job } = withRows(0);
    for (let index = 0; index < total; index += 1) {
      prisma.rowActionLogs.push({ id: `ral_${index}`, createdAt: OLD_DAY });
    }

    const result = await job.archiveOneDay(NOW);

    assert.equal(result?.rows, total);
    assert.equal(
      gunzipSync(storage.objects.get(result!.key)!).toString('utf8').trim().split('\n').length,
      total,
    );
    assert.equal(prisma.rowActionLogs.length, 0);
  });
});
