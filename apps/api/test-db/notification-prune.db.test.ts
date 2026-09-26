import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { DeliveryChannel, DeliveryStatus } from '@prisma/client';
import { DELIVERY_RETENTION_DAYS } from '@iace/contracts';
import {
  DELIVERY_PRUNE_PAGE,
  NotificationPruneProcessor,
} from '../src/notifications/notification-prune.processor';
import { fakeQueueFailures } from '../test/support/fakes';
import { makeNotification, makeStudent, resetDatabase, testPrisma } from './support/database';

const NOW = new Date('2026-09-01T05:00:00.000Z');
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const prisma = testPrisma();
const pruner = new NotificationPruneProcessor(prisma, fakeQueueFailures());

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const daysBefore = (days: number) => new Date(NOW.getTime() - days * MILLISECONDS_PER_DAY);

/** One delivery per channel named, queued at the instant given and in the status given. */
async function deliveries(
  entries: readonly { status: DeliveryStatus; queuedAt: Date; channel?: DeliveryChannel }[],
): Promise<void> {
  const student = await makeStudent(prisma);
  const notification = await makeNotification(prisma, { studentId: student.id });
  const channels = [
    DeliveryChannel.SMS,
    DeliveryChannel.WHATSAPP,
    DeliveryChannel.WEB_PUSH,
    DeliveryChannel.MOBILE_PUSH,
    DeliveryChannel.IN_APP,
    DeliveryChannel.EMAIL,
  ];
  await prisma.notificationDelivery.createMany({
    data: entries.map((entry, at) => ({
      notificationId: notification.id,
      channel: entry.channel ?? channels[at % channels.length] ?? DeliveryChannel.SMS,
      status: entry.status,
      queuedAt: entry.queuedAt,
    })),
  });
}

const remaining = () =>
  prisma.notificationDelivery.findMany({
    select: { status: true, queuedAt: true },
    orderBy: { queuedAt: 'asc' },
  });

describe('NotificationPruneProcessor — what a settled delivery is kept for', () => {
  it('drops a settled delivery past the window and keeps one inside it', async () => {
    await deliveries([
      { status: DeliveryStatus.SENT, queuedAt: daysBefore(DELIVERY_RETENTION_DAYS + 1) },
      { status: DeliveryStatus.SENT, queuedAt: daysBefore(DELIVERY_RETENTION_DAYS - 1) },
    ]);

    assert.equal(await pruner.prune(NOW), 1);

    const left = await remaining();
    assert.equal(left.length, 1);
    assert.equal(left[0]?.queuedAt.getTime(), daysBefore(DELIVERY_RETENTION_DAYS - 1).getTime());
  });

  /** The failure this prevents: a send nobody ever decided, deleted instead of repaired. */
  it('keeps a PENDING delivery however old it is', async () => {
    await deliveries([
      { status: DeliveryStatus.PENDING, queuedAt: daysBefore(DELIVERY_RETENTION_DAYS * 4) },
      { status: DeliveryStatus.FAILED, queuedAt: daysBefore(DELIVERY_RETENTION_DAYS * 4) },
    ]);

    assert.equal(await pruner.prune(NOW), 1);

    const left = await remaining();
    assert.deepEqual(
      left.map((row) => row.status),
      [DeliveryStatus.PENDING],
    );
  });

  it('takes every settled status, not only the sent ones', async () => {
    const old = daysBefore(DELIVERY_RETENTION_DAYS + 30);
    await deliveries([
      { status: DeliveryStatus.SENT, queuedAt: old },
      { status: DeliveryStatus.DELIVERED, queuedAt: old },
      { status: DeliveryStatus.FAILED, queuedAt: old },
      { status: DeliveryStatus.SKIPPED, queuedAt: old },
    ]);

    assert.equal(await pruner.prune(NOW), 4);
    assert.equal((await remaining()).length, 0);
  });

  /** The cap is per run, not per table: a neglected ledger is several nights, never one long lock. */
  it('stops at its page cap and reports what the next run still has to take', async () => {
    const old = daysBefore(DELIVERY_RETENTION_DAYS + 30);
    await deliveries(
      Array.from({ length: 3 }, () => ({ status: DeliveryStatus.SENT, queuedAt: old })),
    );

    const first = await pruner.prune(NOW, 1);

    assert.ok(first > 0 && first <= DELIVERY_PRUNE_PAGE);
    assert.equal((await remaining()).length, 3 - first);
  });
});
