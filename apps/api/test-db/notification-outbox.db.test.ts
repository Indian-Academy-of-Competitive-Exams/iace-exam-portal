import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { DeliveryChannel } from '@prisma/client';
import { NOTIFICATION_TYPE } from '@iace/contracts';
import {
  NOTIFICATION_REQUEST,
  NotificationOutbox,
  type NotificationIntent,
} from '../src/notifications/notification-outbox';
import { NotificationsProcessor } from '../src/notifications/notifications.processor';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PushService } from '../src/notifications/push.service';
import { TestOpeningService } from '../src/notifications/test-opening.service';
import { NOTIFICATION_WRITE_JOB_ID } from '../src/queue/queues';
import {
  FakeConfig,
  FakeFcmSender,
  FakePushSender,
  FakeQueue,
  fakeQueueFailures,
} from '../test/support/fakes';
import { makeAnnouncement, makeStudent, resetDatabase, testPrisma, uid } from './support/database';

/** The durable path: the fact and the intent commit together, and the queue is a later step. */

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

function build() {
  const queue = new FakeQueue();
  const deliveries = new FakeQueue();
  const outbox = new NotificationOutbox(queue.asQueue());
  const push = new PushService(
    prisma,
    new FakeConfig().asService(),
    new FakePushSender(false) as never,
    new FakeFcmSender(false) as never,
  );
  // Nothing here opens a test, so the audience it would fan out to is deliberately empty.
  const access = { studentsReaching: () => Promise.resolve([]) } as never;
  return {
    queue,
    deliveries,
    outbox,
    processor: new NotificationsProcessor(
      prisma,
      new NotificationsService(prisma),
      outbox,
      push,
      new TestOpeningService(prisma, access, outbox),
      deliveries.asQueue(),
      fakeQueueFailures(),
    ),
  };
}

/** A result for a real student: the row the processor writes has a foreign key to them. */
async function intentFor(over: Partial<NotificationIntent> = {}): Promise<NotificationIntent> {
  const student = await makeStudent(prisma);
  return {
    studentId: student.id,
    type: NOTIFICATION_TYPE.RESULT_READY,
    title: 'Your result is ready',
    dedupeKey: 'result:att_1',
    ...over,
  };
}

const requestRow = (id: string) => prisma.outboxEvent.findUniqueOrThrow({ where: { id } });

describe('Asking for a notification', () => {
  it('writes the request with the caller transaction, not to the queue', async () => {
    const { queue, outbox } = build();

    await outbox.request(prisma, await intentFor());

    assert.equal(await prisma.outboxEvent.count(), 1);
    assert.equal(queue.jobs.length, 0, 'the queue is a later, repeatable step');
  });

  it('writes one request per recipient of an announcement', async () => {
    const { outbox } = build();

    await outbox.requestMany(prisma, [await intentFor(), await intentFor()]);

    assert.equal(await prisma.outboxEvent.count(), 2);
  });
});

describe('Asking for a pass', () => {
  /** A hall's worth of results asks for one job, and the row it named stays for the pass to claim. */
  it('asks for one pass and marks nothing itself', async () => {
    const { queue, outbox } = build();
    const eventId = await outbox.request(prisma, await intentFor());

    await outbox.relay();
    await outbox.relay();

    assert.equal(queue.jobs.length, 1, 'one id, so a burst collapses into a single pass');
    assert.equal(queue.jobs[0]?.jobId, NOTIFICATION_WRITE_JOB_ID);
    // The key only holds while nothing is kept under it: a retained failure swallows the repair.
    assert.equal(queue.jobs[0]?.removeOnFail, true);
    assert.equal((await requestRow(eventId)).processedAt, null, 'the pass marks it, not the ask');
  });

  /** A request nothing can act on must not block every request behind it. */
  it('marks an unreadable request with the page and writes nothing for it', async () => {
    const { processor } = build();
    const unreadable = await prisma.outboxEvent.create({
      data: {
        aggregateType: NOTIFICATION_REQUEST.AGGREGATE_TYPE,
        aggregateId: uid('student'),
        eventType: NOTIFICATION_REQUEST.EVENT_TYPE,
        payload: { nothing: 'usable' },
      },
    });

    await processor.writePending();

    assert.equal(await prisma.notification.count(), 0);
    assert.notEqual((await requestRow(unreadable.id)).processedAt, null);
  });
});

describe('Acting on a relayed request', () => {
  it('writes the row the student reads', async () => {
    const { outbox, processor } = build();
    const intent = await intentFor();
    await outbox.request(prisma, intent);

    await processor.writePending();

    const rows = await prisma.notification.findMany();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.title, intent.title);
  });

  /** At-least-once arriving, exactly-once landing: the second pass loses to the dedupe key. */
  it('tells a student once however many times the job runs', async () => {
    const { outbox, processor } = build();
    const eventId = await outbox.request(
      prisma,
      await intentFor({ escalate: [DeliveryChannel.WHATSAPP] }),
    );

    await processor.writePending();
    await prisma.outboxEvent.update({ where: { id: eventId }, data: { processedAt: null } });
    await processor.writePending();

    assert.equal(await prisma.notification.count(), 1);
    assert.equal(
      await prisma.notificationDelivery.count(),
      1,
      'and does not buy a second paid message',
    );
  });

  /** A pruned request has already been acted on; re-writing it would tell somebody twice. */
  it('writes nothing when there is nothing pending', async () => {
    const { processor } = build();

    assert.equal(await processor.writePending(), 0);
    assert.equal(await prisma.notification.count(), 0);
  });
});

describe('An announcement, end to end', () => {
  /** Prevents a scheduler asking POLICY, not what was BOOKED, leaving every announcement unsent. */
  it('books the channel an admin chose and actually queues it', async () => {
    const { deliveries, outbox, processor } = build();
    const announcement = await makeAnnouncement(prisma, [DeliveryChannel.WHATSAPP]);
    await outbox.request(
      prisma,
      await intentFor({
        type: NOTIFICATION_TYPE.GENERIC,
        title: 'Branch closed tomorrow',
        dedupeKey: `announcement:${announcement.id}`,
        announcementId: announcement.id,
        escalate: [DeliveryChannel.WHATSAPP],
      }),
    );

    await processor.writePending();

    const booked = await prisma.notificationDelivery.findMany();
    assert.deepEqual(
      booked.map((delivery) => delivery.channel),
      [DeliveryChannel.WHATSAPP],
    );
    assert.equal(deliveries.jobs.length, 1, 'booked is not enough; it has to be queued');
  });

  /** An in-app-only announcement spends nothing, so there is nothing to book and nothing to queue. */
  it('queues nothing when the admin chose no paid channel', async () => {
    const { deliveries, outbox, processor } = build();
    const announcement = await makeAnnouncement(prisma);
    await outbox.request(
      prisma,
      await intentFor({
        type: NOTIFICATION_TYPE.GENERIC,
        title: 'Branch closed tomorrow',
        dedupeKey: undefined,
        announcementId: announcement.id,
        escalate: [],
      }),
    );

    await processor.writePending();

    assert.equal(await prisma.notification.count(), 1);
    assert.equal(await prisma.notificationDelivery.count(), 0);
    assert.equal(deliveries.jobs.length, 0);
  });
});
