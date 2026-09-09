import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DeliveryChannel } from '@prisma/client';
import { NOTIFICATION_TYPE } from '@iace/contracts';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { NotificationsProcessor } from '../src/notifications/notifications.processor';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NotificationPreferencesService } from '../src/notifications/notification-preferences.service';
import { PushService } from '../src/notifications/push.service';
import { TestOpeningService } from '../src/notifications/test-opening.service';
import { FakeConfig, FakeNotificationsPrisma, FakePushSender, FakeQueue } from './support/fakes';

/** The durable path: the fact and the intent commit together, and the queue is a later step. */

const INTENT = {
  studentId: 'stu_1',
  type: NOTIFICATION_TYPE.RESULT_READY,
  title: 'Your result is ready',
  dedupeKey: 'result:att_1',
};

/** No kind pays by default, so a test about not buying twice has to be told to buy once. */
const PAID_INTENT = { ...INTENT, escalate: [DeliveryChannel.WHATSAPP] };

function build() {
  const prisma = new FakeNotificationsPrisma();
  const queue = new FakeQueue();
  const deliveries = new FakeQueue();
  const outbox = new NotificationOutbox(prisma.asService(), queue.asQueue());
  const service = new NotificationsService(prisma.asService());
  const preferences = new NotificationPreferencesService(
    prisma.asService(),
    new FakeConfig().asService(),
  );
  const push = new PushService(prisma.asService(), preferences, new FakePushSender(false));
  // Nothing here opens a test, so the audience it would fan out to is deliberately empty.
  const access = { studentsReaching: () => Promise.resolve([]) } as never;
  const openings = new TestOpeningService(prisma.asService(), access, outbox);
  return {
    prisma,
    queue,
    deliveries,
    outbox,
    processor: new NotificationsProcessor(
      prisma.asService(),
      service,
      outbox,
      push,
      openings,
      deliveries.asQueue(),
    ),
  };
}

describe('Asking for a notification', () => {
  it('writes the request with the caller transaction, not to the queue', async () => {
    const { prisma, queue, outbox } = build();

    await outbox.request(prisma.asService(), INTENT);

    assert.equal(prisma.outboxEvents.length, 1);
    assert.equal(queue.jobs.length, 0, 'the queue is a later, repeatable step');
  });

  it('writes one request per recipient of an announcement', async () => {
    const { prisma, outbox } = build();

    await outbox.requestMany(prisma.asService(), [
      { ...INTENT, studentId: 'stu_1' },
      { ...INTENT, studentId: 'stu_2' },
    ]);

    assert.equal(prisma.outboxEvents.length, 2);
  });
});

describe('Relaying a request', () => {
  it('hands it on and marks it, keyed so a redelivery is the same job', async () => {
    const { prisma, queue, outbox } = build();
    const eventId = await outbox.request(prisma.asService(), INTENT);

    await outbox.relay(eventId);

    assert.equal(queue.jobs.length, 1);
    assert.equal(queue.jobs[0]?.jobId, `notifications-${eventId}`);
    assert.notEqual(prisma.outboxEvents[0]?.processedAt, null);
  });

  /** The crash this whole shape exists for: unqueued must mean unmarked, so a sweep finds it again. */
  it('leaves a request pending when the queue cannot take it', async () => {
    const { prisma, queue, outbox } = build();
    const eventId = await outbox.request(prisma.asService(), INTENT);
    queue.failNext = true;

    await outbox.relay(eventId);

    assert.equal(prisma.outboxEvents[0]?.processedAt, null, 'still pending, so a sweep retries it');
  });

  /** A request nothing can act on is marked anyway, or it blocks every request behind it. */
  it('drops an unreadable request rather than blocking the queue behind it', async () => {
    const { prisma, queue, outbox } = build();
    await prisma.outboxEvent.create({
      data: {
        aggregateType: 'Notification',
        aggregateId: 'stu_1',
        eventType: 'notification.requested',
        payload: { nothing: 'usable' },
      },
    });

    await outbox.relay();

    assert.equal(queue.jobs.length, 0);
    assert.notEqual(prisma.outboxEvents[0]?.processedAt, null);
  });
});

describe('Acting on a relayed request', () => {
  it('writes the row the student reads', async () => {
    const { prisma, outbox, processor } = build();
    const eventId = await outbox.request(prisma.asService(), INTENT);

    await processor.write(eventId);

    assert.equal(prisma.rows.length, 1);
    assert.equal(prisma.rows[0]?.title, INTENT.title);
  });

  /** At-least-once arriving, exactly-once landing: the second pass loses to the dedupe key. */
  it('tells a student once however many times the job runs', async () => {
    const { prisma, outbox, processor } = build();
    const eventId = await outbox.request(prisma.asService(), PAID_INTENT);

    await processor.write(eventId);
    await processor.write(eventId);

    assert.equal(prisma.rows.length, 1);
    assert.equal(prisma.deliveries.length, 1, 'and does not buy a second paid message');
  });

  /** A pruned request has already been acted on; re-writing it would tell somebody twice. */
  it('writes nothing for a request that is gone', async () => {
    const { prisma, processor } = build();

    await processor.write('obx_missing');

    assert.equal(prisma.rows.length, 0);
  });
});

describe('An announcement, end to end', () => {
  /** Prevents a scheduler asking POLICY, not what was BOOKED, leaving every announcement unsent. */
  it('books the channel an admin chose and actually queues it', async () => {
    const { prisma, deliveries, outbox, processor } = build();
    const eventId = await outbox.request(prisma.asService(), {
      studentId: 'stu_1',
      type: NOTIFICATION_TYPE.GENERIC,
      title: 'Branch closed tomorrow',
      dedupeKey: 'announcement:anc_1',
      announcementId: 'anc_1',
      escalate: [DeliveryChannel.WHATSAPP],
    });

    await processor.write(eventId);

    assert.deepEqual(
      prisma.deliveries.map((delivery) => delivery.channel),
      [DeliveryChannel.WHATSAPP],
    );
    assert.equal(deliveries.jobs.length, 1, 'booked is not enough; it has to be queued');
  });

  /** An in-app-only announcement spends nothing, so there is nothing to book and nothing to queue. */
  it('queues nothing when the admin chose no paid channel', async () => {
    const { prisma, deliveries, outbox, processor } = build();
    const eventId = await outbox.request(prisma.asService(), {
      studentId: 'stu_1',
      type: NOTIFICATION_TYPE.GENERIC,
      title: 'Branch closed tomorrow',
      announcementId: 'anc_1',
      escalate: [],
    });

    await processor.write(eventId);

    assert.equal(prisma.rows.length, 1);
    assert.equal(prisma.deliveries.length, 0);
    assert.equal(deliveries.jobs.length, 0);
  });
});
