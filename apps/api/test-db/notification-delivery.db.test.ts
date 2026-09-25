import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { DeliveryChannel, DeliveryStatus } from '@prisma/client';
import { NOTIFICATION_TYPE } from '@iace/contracts';
import {
  DELIVERY_STALE_AFTER_MS,
  NotificationDeliveryProcessor,
} from '../src/notifications/notification-delivery.processor';
import { NotificationsService } from '../src/notifications/notifications.service';
import { type PaidChannel } from '../src/notifications/notification-policy';
import {
  MESSAGE_CHANNELS,
  MessageNotConfiguredError,
  type MessageChannel,
  type MessageSender,
} from '../src/common/messaging';
import { FakeMessageSender, FakeQueue, fakeQueueFailures } from '../test/support/fakes';
import { makeAnnouncement, makeStudent, resetDatabase, testPrisma } from './support/database';

/** The only place money is spent, so every branch here is either a send or a decision not to. */

const MOBILE = '9876543210';

/** No KIND pays by default any more, so every send here is one an admin chose for that message. */
const CHOSEN: PaidChannel[] = [DeliveryChannel.WHATSAPP, DeliveryChannel.SMS];

const prisma = testPrisma();
const service = new NotificationsService(prisma);

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** Every send is an announcement's: its `paidChannels` is the only place a fallback reads a chain. */
async function build(
  escalate: PaidChannel[] = [DeliveryChannel.WHATSAPP],
  unreachable: MessageChannel[] = [],
) {
  const queue = new FakeQueue();
  const sender = new FakeMessageSender(unreachable);
  const processor = new NotificationDeliveryProcessor(
    prisma,
    service,
    sender,
    queue.asQueue(),
    fakeQueueFailures(),
  );
  const student = await makeStudent(prisma, { mobile: MOBILE });
  const announcement = await makeAnnouncement(prisma, escalate);
  await service.create({
    studentId: student.id,
    type: NOTIFICATION_TYPE.GENERIC,
    title: 'Something happened',
    announcementId: announcement.id,
    escalate,
  });
  const [booked] = await prisma.notificationDelivery.findMany();
  return { queue, sender, processor, deliveryId: booked?.id ?? '' };
}

const deliveryRow = (id: string) =>
  prisma.notificationDelivery.findUniqueOrThrow({ where: { id } });

describe('Spending on a notification', () => {
  it('sends on the channel policy booked', async () => {
    const { processor, sender, deliveryId } = await build();

    await processor.deliver(deliveryId, 1);

    assert.equal(sender.lastMessage.channel, MESSAGE_CHANNELS.WHATSAPP);
    assert.equal(sender.lastMessage.to, MOBILE);
    assert.equal((await deliveryRow(deliveryId)).status, DeliveryStatus.SENT);
  });

  /** The whole point of the grace window: the free channels worked, so this costs nothing. */
  it('spends nothing on a student who already read it', async () => {
    const { processor, sender, deliveryId } = await build();
    await prisma.notification.updateMany({ data: { isRead: true } });

    await processor.deliver(deliveryId, 1);

    assert.equal(sender.sent.length, 0, 'nothing was bought');
    const row = await deliveryRow(deliveryId);
    assert.equal(row.status, DeliveryStatus.SKIPPED);
    assert.equal(row.skipReason, 'ALREADY_READ');
  });

  /** A number we cannot reach is a decision recorded, not a log line nobody reads. */
  it('records a student it has no way to reach', async () => {
    const processor = new NotificationDeliveryProcessor(
      prisma,
      service,
      new FakeMessageSender(),
      new FakeQueue().asQueue(),
      fakeQueueFailures(),
    );
    const gone = await makeStudent(prisma, { deletedAt: new Date() });
    await service.create({
      studentId: gone.id,
      type: NOTIFICATION_TYPE.RESULT_READY,
      title: 'Your result is ready',
      escalate: [DeliveryChannel.WHATSAPP],
    });
    const [booked] = await prisma.notificationDelivery.findMany();

    await processor.deliver(booked?.id ?? '', 1);

    const row = await deliveryRow(booked?.id ?? '');
    assert.equal(row.status, DeliveryStatus.SKIPPED);
    assert.equal(row.skipReason, 'NO_CONTACT');
  });

  /** Already sent or already skipped: a re-run must not buy the same message twice. */
  it('does nothing for a delivery that is no longer pending', async () => {
    const { processor, sender, deliveryId } = await build();
    await prisma.notificationDelivery.updateMany({ data: { status: DeliveryStatus.SENT } });

    await processor.deliver(deliveryId, 1);

    assert.equal(sender.sent.length, 0);
  });
});

describe('When a channel will not take it', () => {
  /** Under the cap the SAME channel is retried, which is what BullMQ's backoff is for. */
  it('rethrows below the attempt cap rather than falling back early', async () => {
    const { processor, deliveryId } = await build(CHOSEN, [MESSAGE_CHANNELS.WHATSAPP]);

    await assert.rejects(processor.deliver(deliveryId, 1));

    assert.equal(
      await prisma.notificationDelivery.count(),
      1,
      'no fallback booked while retries remain',
    );
    const row = await deliveryRow(deliveryId);
    assert.equal(row.attempts, 1);
    assert.equal(row.status, DeliveryStatus.PENDING);
  });

  /** Out of retries, so the chain moves on — WhatsApp to SMS, which is the last resort. */
  it('books the next channel once the attempts are spent', async () => {
    const { processor, queue, deliveryId } = await build(CHOSEN, [MESSAGE_CHANNELS.WHATSAPP]);

    await processor.deliver(deliveryId, 4);

    assert.equal((await deliveryRow(deliveryId)).status, DeliveryStatus.FAILED);
    const fallback = await prisma.notificationDelivery.findMany({
      where: { channel: DeliveryChannel.SMS },
    });
    assert.equal(fallback.length, 1);
    assert.equal(queue.jobs.length, 1, 'and the fallback is queued, not merely recorded');
  });

  /** A kind with nothing left in its chain stops, rather than looping on the last channel. */
  it('stops when the chain runs out', async () => {
    const { processor, queue, deliveryId } = await build(
      [DeliveryChannel.WHATSAPP],
      [MESSAGE_CHANNELS.WHATSAPP],
    );

    await processor.deliver(deliveryId, 4);

    assert.equal(await prisma.notificationDelivery.count(), 1);
    assert.equal(queue.jobs.length, 0);
  });
});

describe('A channel with no template registered', () => {
  /** Prevents a sender that resolves without sending being recorded as delivered. */
  it('is recorded as skipped, never as sent', async () => {
    const unconfigured: MessageSender = {
      send: () => Promise.reject(new MessageNotConfiguredError('announcement')),
    };
    const processor = new NotificationDeliveryProcessor(
      prisma,
      service,
      unconfigured,
      new FakeQueue().asQueue(),
      fakeQueueFailures(),
    );
    const student = await makeStudent(prisma, { mobile: MOBILE });
    await service.create({
      studentId: student.id,
      type: NOTIFICATION_TYPE.RESULT_READY,
      title: 'Your result is ready',
      escalate: [DeliveryChannel.WHATSAPP],
    });
    const [booked] = await prisma.notificationDelivery.findMany();

    await processor.deliver(booked?.id ?? '', 1);

    const row = await deliveryRow(booked?.id ?? '');
    assert.equal(row.status, DeliveryStatus.SKIPPED);
    assert.equal(row.skipReason, 'NO_TEMPLATE');
  });
});

describe('A delivery the queue lost track of', () => {
  /** BullMQ's stall path drops a job without ever running `process()`, so nothing else moves this row. */
  it('forces a channel past its window to a terminal state and books the fallback', async () => {
    const { processor, queue, deliveryId } = await build(CHOSEN, [MESSAGE_CHANNELS.WHATSAPP]);
    await prisma.notificationDelivery.updateMany({
      data: { queuedAt: new Date(Date.now() - DELIVERY_STALE_AFTER_MS - 1000) },
    });

    await processor.repairStalled();

    assert.equal((await deliveryRow(deliveryId)).status, DeliveryStatus.FAILED);
    const fallback = await prisma.notificationDelivery.findMany({
      where: { channel: DeliveryChannel.SMS },
    });
    assert.equal(fallback.length, 1, 'the chain moved on, exactly as the in-band cap would');
    assert.equal(queue.jobs.length, 1, 'and the fallback is queued, not merely recorded');
  });

  /** Still legitimately waiting out its defer or its own backoff — repairing this would double-send. */
  it('leaves a delivery still inside its window alone', async () => {
    const { processor, sender, deliveryId } = await build(CHOSEN, [MESSAGE_CHANNELS.WHATSAPP]);

    await processor.repairStalled();

    assert.equal(sender.sent.length, 0, 'nothing was attempted');
    assert.equal((await deliveryRow(deliveryId)).status, DeliveryStatus.PENDING);
  });
});
