import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { DeliveryChannel } from '@prisma/client';
import { NOTIFICATION_TYPE } from '@iace/contracts';
import { NotificationDeliveryProcessor } from '../src/notifications/notification-delivery.processor';
import { NotificationsProcessor } from '../src/notifications/notifications.processor';
import {
  NotificationsService,
  type NewNotification,
} from '../src/notifications/notifications.service';
import { type PushService } from '../src/notifications/push.service';
import { TestOpeningService } from '../src/notifications/test-opening.service';
import { FakeMessageSender, FakeQueue, fakeQueueFailures } from '../test/support/fakes';
import { makeAnnouncement, makeStudent, resetDatabase, testPrisma } from './support/database';

/** The bell row is written with the fact; this sweep is what pushes it, once, and books any paid chain. */

const prisma = testPrisma();
const notifications = new NotificationsService(prisma);

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

function build(pushed: string[] = []) {
  const deliveries = new FakeQueue();
  const push = {
    deliverAll: (inputs: { notificationId: string }[]) => {
      pushed.push(...inputs.map((input) => input.notificationId));
      return Promise.resolve();
    },
  } as unknown as PushService;
  // Nothing here opens a test, so the audience it would fan out to is deliberately empty.
  const access = { studentsReaching: () => Promise.resolve([]) } as never;
  const processor = new NotificationsProcessor(
    prisma,
    push,
    new TestOpeningService(prisma, access, notifications),
    new NotificationDeliveryProcessor(
      prisma,
      notifications,
      new FakeMessageSender(),
      deliveries.asQueue(),
      fakeQueueFailures(),
    ),
    deliveries.asQueue(),
    fakeQueueFailures(),
  );
  return { processor, deliveries, pushed };
}

async function told(over: Partial<NewNotification> = {}): Promise<void> {
  const student = await makeStudent(prisma);
  await notifications.tell(prisma, {
    studentId: student.id,
    type: NOTIFICATION_TYPE.RESULT_READY,
    title: 'Your result is ready',
    ...over,
  });
}

const unpushed = () => prisma.notification.count({ where: { pushedAt: null } });

describe('The push sweep', () => {
  it('pushes every row nobody has pushed, and stamps each', async () => {
    const { processor, pushed } = build();
    await told();
    await told();

    assert.equal(await processor.pushPending(), 2);

    assert.equal(pushed.length, 2);
    assert.equal(await unpushed(), 0);
  });

  it('pushes nothing the second time round', async () => {
    const { processor, pushed } = build();
    await told();
    await processor.pushPending();

    assert.equal(await processor.pushPending(), 0);
    assert.equal(pushed.length, 1);
  });

  /** The failure this prevents: two workers on one sweep each pushing the same row. */
  it('pushes each row once when two passes run at the same moment', async () => {
    const pushed: string[] = [];
    const [first, second] = [build(pushed), build(pushed)];
    for (let at = 0; at < 30; at += 1) await told();

    await Promise.all([first.processor.pushPending(), second.processor.pushPending()]);

    assert.equal(pushed.length, 30);
    assert.equal(new Set(pushed).size, 30);
  });

  /** One page a sweep would leave a hall's results waiting minutes for their push. */
  it('drains a backlog rather than one page of it', async () => {
    const { processor } = build();
    const student = await makeStudent(prisma);
    await notifications.tell(
      prisma,
      ...Array.from({ length: 450 }, () => ({
        studentId: student.id,
        type: NOTIFICATION_TYPE.GENERIC,
        title: 'Branch closed tomorrow',
      })),
    );

    assert.equal(await processor.pushPending(), 450);
    assert.equal(await unpushed(), 0);
  });
});

describe('An announcement with a paid channel', () => {
  /** Prevents a scheduler asking POLICY, not what was BOOKED, leaving every announcement unsent. */
  it('books the channel the admin chose first, and queues it', async () => {
    const { processor, deliveries } = build();
    const announcement = await makeAnnouncement(prisma, [
      DeliveryChannel.WHATSAPP,
      DeliveryChannel.SMS,
    ]);
    await told({ type: NOTIFICATION_TYPE.GENERIC, announcementId: announcement.id });

    await processor.pushPending();

    const booked = await prisma.notificationDelivery.findMany();
    assert.deepEqual(
      booked.map((delivery) => delivery.channel),
      [DeliveryChannel.WHATSAPP],
      'SMS is what WhatsApp falls back TO, not something sent beside it',
    );
    assert.equal(deliveries.jobs.length, 1, 'booked is not enough; it has to be queued');
  });

  it('books and queues nothing when the admin chose no paid channel', async () => {
    const { processor, deliveries } = build();
    const announcement = await makeAnnouncement(prisma);
    await told({ type: NOTIFICATION_TYPE.GENERIC, announcementId: announcement.id });

    await processor.pushPending();

    assert.equal(await prisma.notificationDelivery.count(), 0);
    assert.equal(deliveries.jobs.length, 0);
  });

  /** A pass that dies after its claim is retried by hand; it must not buy the message twice. */
  it('does not book a second paid message when a row is swept again', async () => {
    const { processor } = build();
    const announcement = await makeAnnouncement(prisma, [DeliveryChannel.WHATSAPP]);
    await told({ type: NOTIFICATION_TYPE.GENERIC, announcementId: announcement.id });

    await processor.pushPending();
    await prisma.notification.updateMany({ data: { pushedAt: null } });
    await processor.pushPending();

    assert.equal(await prisma.notificationDelivery.count(), 1);
  });
});
