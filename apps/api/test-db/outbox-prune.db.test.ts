import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import {
  OUTBOX_PRUNE_PAGE,
  OUTBOX_RETENTION_DAYS,
  OutboxPruneProcessor,
} from '../src/common/events/outbox-prune.processor';
import { SCORING_REQUEST } from '../src/attempts/scoring-outbox';
import { fakeQueueFailures } from '../test/support/fakes';
import { resetDatabase, testPrisma } from './support/database';

const NOW = new Date('2026-09-01T05:00:00.000Z');
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const prisma = testPrisma();
const pruner = new OutboxPruneProcessor(prisma, fakeQueueFailures());

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const daysBefore = (days: number) => new Date(NOW.getTime() - days * MILLISECONDS_PER_DAY);

const idCache = new Map<string, string>();
const idFor = (label: string): string => {
  const cached = idCache.get(label);
  if (cached) return cached;
  const id = randomUUID();
  idCache.set(label, id);
  return id;
};

/** Scoring requests, relayed at the instant given or never; each created before it was relayed. */
const requests = (entries: Record<string, Date | null>) =>
  prisma.outboxEvent.createMany({
    data: Object.entries(entries).map(([label, processedAt]) => ({
      id: idFor(label),
      aggregateType: SCORING_REQUEST.AGGREGATE_TYPE,
      aggregateId: randomUUID(),
      eventType: SCORING_REQUEST.EVENT_TYPE,
      payload: { testId: 'tst_1' },
      createdAt: processedAt ?? daysBefore(OUTBOX_RETENTION_DAYS + 30),
      processedAt,
    })),
  });

const idsLeft = async () =>
  (await prisma.outboxEvent.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map(
    (row) => row.id,
  );

describe('OutboxPruneProcessor', () => {
  it('removes requests that were relayed longer ago than the grace', async () => {
    await requests({ old: daysBefore(OUTBOX_RETENTION_DAYS + 1), recent: daysBefore(1) });

    assert.equal(await pruner.prune(NOW), 1);
    assert.deepEqual(await idsLeft(), [idFor('recent')]);
  });

  /** The failure this prevents: deleting a request would strand its attempt unscored forever. */
  it('never removes one nobody has relayed, however old it is', async () => {
    await requests({ stranded: null, relayed: daysBefore(OUTBOX_RETENTION_DAYS + 1) });

    assert.equal(await pruner.prune(NOW), 1);
    assert.deepEqual(await idsLeft(), [idFor('stranded')]);
  });

  /** A neglected table is drained over several runs rather than in one lock nobody can wait out. */
  it('stops at its page bound and leaves the rest for the next run', async () => {
    const relayed = daysBefore(OUTBOX_RETENTION_DAYS + 1);
    await requests(
      Object.fromEntries(
        Array.from({ length: OUTBOX_PRUNE_PAGE + 1 }, (_, at) => [`e${at}`, relayed]),
      ),
    );

    assert.equal(await pruner.prune(NOW, 1), OUTBOX_PRUNE_PAGE);
    assert.equal(await prisma.outboxEvent.count(), 1);
    // The run that follows finishes it, so the bound is a pause and never a leak.
    assert.equal(await pruner.prune(NOW), 1);
  });

  it('has nothing to do on a table that is all fresh', async () => {
    await requests({ fresh: daysBefore(1) });

    assert.equal(await pruner.prune(NOW), 0);
    assert.deepEqual(await idsLeft(), [idFor('fresh')]);
  });
});
