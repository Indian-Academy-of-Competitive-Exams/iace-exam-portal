import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OUTBOX_PRUNE_PAGE,
  OUTBOX_RETENTION_DAYS,
  OutboxPruneProcessor,
} from '../src/common/events/outbox-prune.processor';
import { SCORING_REQUEST } from '../src/attempts/scoring-outbox';
import { FakeTestsPrisma, type FakeOutboxRow } from './support/fakes';

const NOW = new Date('2026-09-01T05:00:00.000Z');
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const daysBefore = (days: number) => new Date(NOW.getTime() - days * MILLISECONDS_PER_DAY);

function request(id: string, processedAt: Date | null): FakeOutboxRow {
  return {
    id,
    aggregateType: SCORING_REQUEST.AGGREGATE_TYPE,
    aggregateId: `att_${id}`,
    eventType: SCORING_REQUEST.EVENT_TYPE,
    payload: { testId: 'tst_1' },
    createdAt: processedAt ?? daysBefore(OUTBOX_RETENTION_DAYS + 30),
    processedAt,
  };
}

function build(rows: FakeOutboxRow[]) {
  const prisma = new FakeTestsPrisma();
  prisma.outboxEvents.push(...rows);
  return { prisma, pruner: new OutboxPruneProcessor(prisma.asService()) };
}

const idsLeft = (prisma: FakeTestsPrisma) => prisma.outboxEvents.map((row) => row.id).sort();

describe('OutboxPruneProcessor', () => {
  it('removes requests that were relayed longer ago than the grace', async () => {
    const { prisma, pruner } = build([
      request('old', daysBefore(OUTBOX_RETENTION_DAYS + 1)),
      request('recent', daysBefore(1)),
    ]);

    const removed = await pruner.prune(NOW);

    assert.equal(removed, 1);
    assert.deepEqual(idsLeft(prisma), ['recent']);
  });

  /** The failure this prevents: deleting a request would strand its attempt unscored forever. */
  it('never removes one nobody has relayed, however old it is', async () => {
    const { prisma, pruner } = build([
      request('stranded', null),
      request('relayed', daysBefore(OUTBOX_RETENTION_DAYS + 1)),
    ]);

    const removed = await pruner.prune(NOW);

    assert.equal(removed, 1);
    assert.deepEqual(idsLeft(prisma), ['stranded']);
  });

  /** A neglected table is drained over several runs rather than in one lock nobody can wait out. */
  it('stops at its page bound and leaves the rest for the next run', async () => {
    const stale = Array.from({ length: OUTBOX_PRUNE_PAGE + 1 }, (_, index) =>
      request(`e${index}`, daysBefore(OUTBOX_RETENTION_DAYS + 1)),
    );

    const { prisma, pruner } = build(stale);
    const removed = await pruner.prune(NOW, 1);

    assert.equal(removed, OUTBOX_PRUNE_PAGE);
    assert.equal(prisma.outboxEvents.length, 1);
    // The run that follows finishes it, so the bound is a pause and never a leak.
    assert.equal(await pruner.prune(NOW), 1);
  });

  it('has nothing to do on a table that is all fresh', async () => {
    const { prisma, pruner } = build([request('fresh', daysBefore(1))]);

    assert.equal(await pruner.prune(NOW), 0);
    assert.deepEqual(idsLeft(prisma), ['fresh']);
  });
});
