import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DeliveryChannel, DeliveryStatus } from '@prisma/client';
import { NOTIFICATION_TYPE, type NotificationType } from '@iace/contracts';
import { NotificationDeliveryProcessor } from '../src/notifications/notification-delivery.processor';
import { NotificationsService } from '../src/notifications/notifications.service';
import { MESSAGE_CHANNELS } from '../src/common/messaging';
import { FakeMessageSender, FakeNotificationsPrisma, FakeQueue } from './support/fakes';

/** The only place money is spent, so every branch here is either a send or a decision not to. */

const MOBILES = { stu_1: '9876543210' };

async function build(
  type: NotificationType = NOTIFICATION_TYPE.RESULT_READY,
  unreachable: string[] = [],
) {
  const prisma = new FakeNotificationsPrisma([], MOBILES);
  const queue = new FakeQueue();
  const sender = new FakeMessageSender(unreachable as never);
  const service = new NotificationsService(prisma.asService());
  const processor = new NotificationDeliveryProcessor(
    prisma.asService(),
    service,
    sender,
    queue.asQueue(),
  );

  await service.create({ studentId: 'stu_1', type, title: 'Something happened' });
  return { prisma, queue, sender, processor, deliveryId: prisma.deliveries[0]?.id ?? '' };
}

describe('Spending on a notification', () => {
  it('sends on the channel policy booked', async () => {
    const { processor, sender, prisma, deliveryId } = await build();

    await processor.deliver(deliveryId, 1);

    assert.equal(sender.lastMessage.channel, MESSAGE_CHANNELS.WHATSAPP);
    assert.equal(sender.lastMessage.to, MOBILES.stu_1);
    assert.equal(prisma.deliveries[0]?.status, DeliveryStatus.SENT);
  });

  /** The whole point of the grace window: the free channels worked, so this costs nothing. */
  it('spends nothing on a student who already read it', async () => {
    const { processor, sender, prisma, deliveryId } = await build();
    prisma.rows.forEach((row) => (row.isRead = true));

    await processor.deliver(deliveryId, 1);

    assert.equal(sender.sent.length, 0, 'nothing was bought');
    assert.equal(prisma.deliveries[0]?.status, DeliveryStatus.SKIPPED);
    assert.equal(prisma.deliveries[0]?.skipReason, 'ALREADY_READ');
  });

  /** A number we cannot reach is a decision recorded, not a log line nobody reads. */
  it('records a student it has no way to reach', async () => {
    const prisma = new FakeNotificationsPrisma([], {});
    const service = new NotificationsService(prisma.asService());
    const processor = new NotificationDeliveryProcessor(
      prisma.asService(),
      service,
      new FakeMessageSender(),
      new FakeQueue().asQueue(),
    );
    await service.create({
      studentId: 'stu_gone',
      type: NOTIFICATION_TYPE.RESULT_READY,
      title: 'Your result is ready',
    });

    await processor.deliver(prisma.deliveries[0]?.id ?? '', 1);

    assert.equal(prisma.deliveries[0]?.status, DeliveryStatus.SKIPPED);
    assert.equal(prisma.deliveries[0]?.skipReason, 'NO_CONTACT');
  });

  /** Already sent or already skipped: a re-run must not buy the same message twice. */
  it('does nothing for a delivery that is no longer pending', async () => {
    const { processor, sender, prisma, deliveryId } = await build();
    prisma.deliveries.forEach((row) => (row.status = DeliveryStatus.SENT));

    await processor.deliver(deliveryId, 1);

    assert.equal(sender.sent.length, 0);
  });
});

describe('When a channel will not take it', () => {
  /** Under the cap the SAME channel is retried, which is what BullMQ's backoff is for. */
  it('rethrows below the attempt cap rather than falling back early', async () => {
    const { processor, prisma, deliveryId } = await build(NOTIFICATION_TYPE.TEST_ASSIGNED, [
      MESSAGE_CHANNELS.WHATSAPP,
    ]);

    await assert.rejects(processor.deliver(deliveryId, 1));

    assert.equal(prisma.deliveries.length, 1, 'no fallback booked while retries remain');
    assert.equal(prisma.deliveries[0]?.attempts, 1);
    assert.equal(prisma.deliveries[0]?.status, DeliveryStatus.PENDING);
  });

  /** Out of retries, so the chain moves on — WhatsApp to SMS, which is the last resort. */
  it('books the next channel once the attempts are spent', async () => {
    const { processor, queue, prisma, deliveryId } = await build(NOTIFICATION_TYPE.TEST_ASSIGNED, [
      MESSAGE_CHANNELS.WHATSAPP,
    ]);

    await processor.deliver(deliveryId, 4);

    assert.equal(prisma.deliveries[0]?.status, DeliveryStatus.FAILED);
    assert.equal(prisma.deliveries[1]?.channel, DeliveryChannel.SMS);
    assert.equal(queue.jobs.length, 1, 'and the fallback is queued, not merely recorded');
  });

  /** A kind with nothing left in its chain stops, rather than looping on the last channel. */
  it('stops when the chain runs out', async () => {
    const { processor, queue, prisma, deliveryId } = await build(NOTIFICATION_TYPE.RESULT_READY, [
      MESSAGE_CHANNELS.WHATSAPP,
    ]);

    await processor.deliver(deliveryId, 4);

    assert.equal(prisma.deliveries.length, 1);
    assert.equal(queue.jobs.length, 0);
  });
});
