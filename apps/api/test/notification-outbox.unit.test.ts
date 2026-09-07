import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NOTIFICATION_TYPE } from '@iace/contracts';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { NotificationsProcessor } from '../src/notifications/notifications.processor';
import { NotificationsService } from '../src/notifications/notifications.service';
import { FakeNotificationsPrisma, FakeQueue } from './support/fakes';

/** The durable path: the fact and the intent commit together, and the queue is a later step. */

const INTENT = {
  studentId: 'stu_1',
  type: NOTIFICATION_TYPE.RESULT_READY,
  title: 'Your result is ready',
  dedupeKey: 'result:att_1',
};

function build() {
  const prisma = new FakeNotificationsPrisma();
  const queue = new FakeQueue();
  const outbox = new NotificationOutbox(prisma.asService(), queue.asQueue());
  const service = new NotificationsService(prisma.asService());
  return {
    prisma,
    queue,
    outbox,
    processor: new NotificationsProcessor(prisma.asService(), service),
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
    const eventId = await outbox.request(prisma.asService(), INTENT);

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
