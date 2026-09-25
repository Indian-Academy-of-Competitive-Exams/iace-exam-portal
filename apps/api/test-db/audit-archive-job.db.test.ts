import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { after, beforeEach, describe, it } from 'node:test';
import { AppException, ErrorCodes } from '@iace/contracts';
import { archiveKeyFor } from '../src/audit/audit-archive';
import {
  AUDIT_ARCHIVE_LOCK_TTL_SEC,
  AUDIT_ARCHIVE_PAGE_SIZE,
  AuditArchiveProcessor,
} from '../src/audit/audit-archive.processor';
import { AuditService } from '../src/audit/audit.service';
import { startOfInstituteDay } from '../src/common/time/institute-day';
import { redisKeys } from '../src/redis/redis.keys';
import { FakeRedis, FakeStorage, fakeQueueFailures } from '../test/support/fakes';
import {
  DEFAULT_ROW_ACTION_ACTOR_ID,
  resetDatabase,
  rowActions,
  testPrisma,
} from './support/database';

const NOW = new Date('2026-04-10T02:00:00Z');
const OLD_DAY = new Date('2026-03-11T09:00:00Z');
const OLD_DAY_KEY = '2026-03-11';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** The object the run said it wrote. A missing key or body is the failure, not the gunzip. */
function archiveOf(storage: { objects: Map<string, Buffer> }, result: { key: string } | null) {
  assert.ok(result, 'the run reported no archive');
  const body = storage.objects.get(result.key);
  assert.ok(body, `nothing was stored at ${result.key}`);
  return body;
}

const linesIn = (body: Buffer) => gunzipSync(body).toString('utf8').trim().split('\n');

/** `count` rows on the old day, and the job over them. */
async function withRows(count: number) {
  await rowActions(
    prisma,
    Array.from({ length: count }, () => ({
      id: randomUUID(),
      entityId: randomUUID(),
      createdAt: OLD_DAY,
    })),
  );
  const storage = new FakeStorage();
  const redis = new FakeRedis();
  return {
    storage,
    redis,
    job: new AuditArchiveProcessor(
      prisma,
      storage as never,
      redis.asService(),
      new AuditService(prisma, new FakeStorage() as never),
      fakeQueueFailures(),
    ),
  };
}

const at = (id: string, iso: string) => ({ id, createdAt: new Date(iso) });

/** Ordered by when each row was made, not by id — an id is a random uuid now, not a sortable label. */
const leftIds = async () =>
  (await prisma.rowActionLog.findMany({ select: { id: true }, orderBy: { createdAt: 'asc' } })).map(
    (row) => row.id,
  );

const dayIsFree = (redis: FakeRedis) =>
  redis.acquireLock(
    redisKeys.auditArchiveDay(OLD_DAY_KEY),
    randomUUID(),
    AUDIT_ARCHIVE_LOCK_TTL_SEC,
  );

describe('AuditArchiveProcessor', () => {
  it('writes the day to S3 and then deletes exactly that day', async () => {
    const { storage, job } = await withRows(3);

    const result = await job.archiveOneDay(NOW);

    assert.equal(result?.rows, 3);
    assert.equal(result?.key, 'audit/row-actions/2026/03/11.ndjson.gz');
    assert.equal(linesIn(archiveOf(storage, result)).length, 3);
    assert.equal(await prisma.rowActionLog.count(), 0);
  });

  /** The failure this exists to prevent: rows deleted on the strength of an upload that never landed. */
  it('deletes nothing when the upload throws, and frees the day for the next run', async () => {
    const { storage, redis, job } = await withRows(3);
    storage.failNextUpload = true;

    await assert.rejects(() => job.archiveOneDay(NOW));

    assert.equal(await prisma.rowActionLog.count(), 3);
    // Released even when the day failed, or one bad upload locks that day out for 15 minutes.
    assert.equal(await dayIsFree(redis), true);
  });

  /** Same failure, quieter: the upload resolved but the object is not what was written. */
  it('deletes nothing when verification disagrees with what was written', async () => {
    const { storage, job } = await withRows(3);
    storage.reportSize(archiveKeyFor(OLD_DAY), 0);

    await assert.rejects(() => job.archiveOneDay(NOW));

    assert.equal(await prisma.rowActionLog.count(), 3);
  });

  it('writes no object and deletes nothing for a day with no rows', async () => {
    const { storage, job } = await withRows(0);

    assert.equal(await job.archiveOneDay(NOW), null);
    assert.equal(storage.objects.size, 0);
  });

  /** A replay after an outage must overwrite the same key and delete the same window. */
  it('is idempotent when the same day is run twice', async () => {
    const { job } = await withRows(2);

    await job.archiveOneDay(NOW);

    assert.equal(await job.archiveOneDay(NOW), null);
    assert.equal(await prisma.rowActionLog.count(), 0);
  });

  /** Rows inside the window are none of this run's business. */
  it('leaves rows newer than the retention boundary alone', async () => {
    const { job } = await withRows(1);
    const ralNew = randomUUID();
    await rowActions(prisma, [at(ralNew, '2026-04-09T09:00:00Z')]);

    await job.archiveOneDay(NOW);

    assert.deepEqual(await leftIds(), [ralNew]);
  });

  /** The most dangerous gap: with `gte` dropped from the delete, a row older than the window is destroyed. */
  it('deletes only the exact [gte, lt) window, not a row just outside either edge', async () => {
    const { job } = await withRows(0);
    const gte = startOfInstituteDay(OLD_DAY_KEY);
    const lt = startOfInstituteDay('2026-03-12');
    const ralBefore = randomUUID();
    const ralAfter = randomUUID();
    await rowActions(prisma, [
      { id: ralBefore, createdAt: new Date(gte.getTime() - 1) },
      { id: randomUUID(), createdAt: gte },
      { id: ralAfter, createdAt: lt },
    ]);

    const result = await job.archiveWindow(gte, lt, lt);

    assert.equal(result?.rows, 1);
    assert.deepEqual(await leftIds(), [ralBefore, ralAfter]);
  });

  /** The failure this prevents: two workers on one day, the second uploading a short body over the whole one. */
  it('leaves a day alone while another worker holds it', async () => {
    const { storage, redis, job } = await withRows(3);

    assert.equal(await dayIsFree(redis), true);
    assert.equal(await job.archiveOneDay(NOW), null);
    assert.equal(await prisma.rowActionLog.count(), 3);
    assert.equal(storage.objects.size, 0);
  });

  /** Released, not left to expire: the next day of the same backlog run has to be able to start. */
  it('frees the day it archived, so a following run is not locked out', async () => {
    const { redis, job } = await withRows(3);

    await job.archiveOneDay(NOW);

    assert.equal(await dayIsFree(redis), true);
  });

  /** The failure this prevents: the only surviving copy of these rows naming its actors by bare id. */
  it('resolves actor names into the archive rather than leaving bare ids', async () => {
    const { storage, job } = await withRows(2);
    await prisma.admin.create({
      data: { id: DEFAULT_ROW_ACTION_ACTOR_ID, fullName: 'R Kumar', email: 'r.kumar@iace.test' },
    });

    const result = await job.archiveOneDay(NOW);

    const names = linesIn(archiveOf(storage, result)).map(
      (line) => (JSON.parse(line) as { actorName: string }).actorName,
    );
    assert.deepEqual(names, ['R Kumar', 'R Kumar']);
  });

  /** `archiveWindow` is public, so it cannot trust its caller to hand it a sane window. */
  describe('archiveWindow refuses a window it cannot safely delete by', () => {
    const invalid = (error: unknown) =>
      error instanceof AppException && error.code === ErrorCodes.VALIDATION_ERROR;

    it('rejects a gte that is not UTC midnight, a window that is not one day, and one past retention', async () => {
      const { job } = await withRows(0);
      const midnight = new Date('2026-03-11T00:00:00Z');
      const nextMidnight = new Date('2026-03-12T00:00:00Z');

      await assert.rejects(
        () =>
          job.archiveWindow(
            new Date('2026-03-11T00:00:01Z'),
            new Date('2026-03-12T00:00:01Z'),
            new Date('2026-03-12T00:00:01Z'),
          ),
        invalid,
      );
      await assert.rejects(
        () =>
          job.archiveWindow(
            midnight,
            new Date('2026-03-13T00:00:00Z'),
            new Date('2026-03-13T00:00:00Z'),
          ),
        invalid,
      );
      await assert.rejects(() => job.archiveWindow(midnight, nextMidnight, midnight), invalid);
    });
  });

  /** A missed run must not strand its day: selection walks the backlog oldest-first. */
  it('clears a multi-day backlog in one run, oldest day first', async () => {
    const { job } = await withRows(0);
    await rowActions(prisma, [
      at(randomUUID(), '2026-02-01T09:00:00Z'),
      at(randomUUID(), '2026-03-05T09:00:00Z'),
      { id: randomUUID(), createdAt: OLD_DAY },
    ]);

    const archived = await job.archivePendingDays(NOW);

    assert.deepEqual(
      archived.map((day) => day.key),
      [
        'audit/row-actions/2026/02/01.ndjson.gz',
        'audit/row-actions/2026/03/05.ndjson.gz',
        'audit/row-actions/2026/03/11.ndjson.gz',
      ],
    );
    assert.equal(await prisma.rowActionLog.count(), 0);
  });

  /** A backlog longer than the bound is not silently truncated — the rest waits for next run. */
  it('stops at the day bound and leaves the remaining backlog untouched', async () => {
    const { job } = await withRows(0);
    const dayIds = new Map(
      ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'].map((day) => [day, randomUUID()]),
    );
    await rowActions(
      prisma,
      [...dayIds].map(([day, id]) => at(id, `${day}T09:00:00Z`)),
    );

    const archived = await job.archivePendingDays(NOW, 2);

    assert.equal(archived.length, 2);
    assert.deepEqual(await leftIds(), [dayIds.get('2026-01-03'), dayIds.get('2026-01-04')]);
  });

  /** The bound was hit, but nothing was left behind — that is success, not a warning-worthy gap. */
  it('does not warn about backlog when the bound exactly clears it', async () => {
    const { job } = await withRows(0);
    await rowActions(prisma, [
      at(randomUUID(), '2026-01-01T09:00:00Z'),
      at(randomUUID(), '2026-01-02T09:00:00Z'),
    ]);
    const warnings: string[] = [];
    (job as unknown as { logger: { warn: (message: string) => void } }).logger.warn = (
      message: string,
    ) => warnings.push(message);

    const archived = await job.archivePendingDays(NOW, 2);

    assert.equal(archived.length, 2);
    assert.deepEqual(warnings, []);
  });

  /** A failure on day 2 must not un-archive day 1, touch day 3, or hide the progress already made. */
  it('preserves already-archived days when a later day in the backlog fails', async () => {
    const { storage, job } = await withRows(0);
    const ralDay2 = randomUUID();
    const ralDay3 = randomUUID();
    await rowActions(prisma, [
      at(randomUUID(), '2026-01-01T09:00:00Z'),
      at(ralDay2, '2026-01-02T09:00:00Z'),
      at(ralDay3, '2026-01-03T09:00:00Z'),
    ]);
    storage.reportSize(archiveKeyFor(new Date('2026-01-02T00:00:00Z')), 0);

    const caught = await job.archivePendingDays(NOW).then(
      () => assert.fail('expected archivePendingDays to reject'),
      (error: unknown) => error,
    );

    assert.ok(caught instanceof AppException);
    const details = caught.details as { archived: { key: string }[] };
    assert.deepEqual(
      details.archived.map((day) => day.key),
      [archiveKeyFor(new Date('2026-01-01T00:00:00Z'))],
    );
    assert.deepEqual(await leftIds(), [ralDay2, ralDay3]);
  });

  /** A bulk-import day must not have to fit in memory as one array to be archived correctly. */
  it('archives a day with more rows than a single page holds', async () => {
    const total = AUDIT_ARCHIVE_PAGE_SIZE + 500;
    const { storage, job } = await withRows(total);

    const result = await job.archiveOneDay(NOW);

    assert.equal(result?.rows, total);
    assert.equal(linesIn(archiveOf(storage, result)).length, total);
    assert.equal(await prisma.rowActionLog.count(), 0);
  });
});
