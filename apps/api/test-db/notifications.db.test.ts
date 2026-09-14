import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { DeliveryChannel } from '@prisma/client';
import { AppException, ErrorCodes, NOTIFICATION_TYPE } from '@iace/contracts';
import { NotificationsService } from '../src/notifications/notifications.service';
import {
  makeCatalog,
  makeNotification,
  makeStudent,
  resetDatabase,
  testPrisma,
} from './support/database';

/** A notification is written from a durable request, so the guarantee is one row per fact. */

const PAGE = { page: 1, pageSize: 20, unreadOnly: undefined };

const prisma = testPrisma();
const service = new NotificationsService(prisma);

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const readOf = async (id: string) =>
  (await prisma.notification.findUniqueOrThrow({ where: { id } })).isRead;

describe('NotificationsService — one student’s own bell', () => {
  /** Two students; the first holds an unread newer row and a read older one. */
  async function twoStudents() {
    const [me, other] = [await makeStudent(prisma), await makeStudent(prisma)];
    const newer = await makeNotification(prisma, {
      studentId: me.id,
      createdAt: new Date('2026-06-02T00:00:00.000Z'),
    });
    const theirs = await makeNotification(prisma, { studentId: other.id });
    const older = await makeNotification(prisma, {
      studentId: me.id,
      isRead: true,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    return { me, newer, theirs, older };
  }

  /** The id is never taken from the request, so there is no shape that reaches another student. */
  it('lists only what belongs to the student asking', async () => {
    const { me, newer, older } = await twoStudents();

    const page = await service.list(me.id, PAGE);

    assert.deepEqual(
      page.items.map((item) => item.id),
      [newer.id, older.id],
    );
    assert.equal(page.total, 2);
  });

  it('narrows to what has not been read yet', async () => {
    const { me, newer } = await twoStudents();

    const page = await service.list(me.id, { ...PAGE, unreadOnly: true });

    assert.deepEqual(
      page.items.map((item) => item.id),
      [newer.id],
    );
  });

  it('marks one row read and leaves the rest alone', async () => {
    const { me, newer, theirs } = await twoStudents();

    const marked = await service.markRead(me.id, newer.id);

    assert.equal(marked.isRead, true);
    assert.equal(await readOf(newer.id), true);
    assert.equal(await readOf(theirs.id), false);
  });

  it('refuses to mark somebody else’s notification read', async () => {
    const { me, theirs } = await twoStudents();

    const error = await service.markRead(me.id, theirs.id).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
    assert.equal(await readOf(theirs.id), false);
  });

  it('serialises the row the student screen reads', async () => {
    const student = await makeStudent(prisma);
    const { testSeriesId } = await makeCatalog(prisma);

    const created = await service.create({
      studentId: student.id,
      type: NOTIFICATION_TYPE.GRANT_ADDED,
      title: 'A test series was added to your account',
      testSeriesId,
    });

    assert.equal(typeof created.createdAt, 'string');
    assert.equal(created.body, null);
    assert.equal(created.testId, null);
  });
});

describe('Writing a notification books what may be spent on it', () => {
  /** No IN_APP row either: the notification itself IS that delivery, and mirroring it doubles the table. */
  it('books nothing at all for any kind, because no kind pays by default', async () => {
    const student = await makeStudent(prisma);

    for (const type of Object.values(NOTIFICATION_TYPE)) {
      await service.create({ studentId: student.id, type, title: 'Something happened' });
    }

    assert.equal(await prisma.notification.count(), Object.values(NOTIFICATION_TYPE).length);
    assert.equal(
      await prisma.notificationDelivery.count(),
      0,
      'in-app first: paying is a per-send decision',
    );
  });

  /** The one way money is spent now: an admin chose it for this send, and the chain is honoured. */
  it('books the channel an override leads with', async () => {
    const student = await makeStudent(prisma);

    await service.create({
      studentId: student.id,
      type: NOTIFICATION_TYPE.GENERIC,
      title: 'Branch closed tomorrow',
      escalate: [DeliveryChannel.WHATSAPP],
    });

    const booked = await prisma.notificationDelivery.findMany();
    assert.deepEqual(
      booked.map((delivery) => delivery.channel),
      [DeliveryChannel.WHATSAPP],
    );
  });

  /** The escalate list is a FALLBACK chain: booking it all at once would buy both messages. */
  it('books only the first of a chain, never the whole of it', async () => {
    const student = await makeStudent(prisma);

    await service.create({
      studentId: student.id,
      type: NOTIFICATION_TYPE.GENERIC,
      title: 'Branch closed tomorrow',
      escalate: [DeliveryChannel.WHATSAPP, DeliveryChannel.SMS],
    });

    const booked = await prisma.notificationDelivery.findMany();
    assert.deepEqual(
      booked.map((delivery) => delivery.channel),
      [DeliveryChannel.WHATSAPP],
      'SMS is what WhatsApp falls back TO, not something sent beside it',
    );
  });

  /** What makes the outbox safe to redeliver: the loser reads back the row it lost to. */
  it('writes one row when the same fact arrives twice', async () => {
    const student = await makeStudent(prisma);
    const fact = {
      studentId: student.id,
      type: NOTIFICATION_TYPE.RESULT_READY,
      title: 'Your result is ready',
      dedupeKey: 'result:att_1',
      escalate: [DeliveryChannel.WHATSAPP],
    };

    const first = await service.create(fact);
    const second = await service.create(fact);

    assert.equal(await prisma.notification.count(), 1);
    assert.equal(second.id, first.id, 'the redelivery reads back the row it lost to');
    assert.equal(
      await prisma.notificationDelivery.count(),
      1,
      'and does not book a second paid message',
    );
  });

  /** An ad-hoc announcement has no natural key, so saying it twice must remain possible. */
  it('lets a keyless notification repeat', async () => {
    const student = await makeStudent(prisma);
    const adHoc = {
      studentId: student.id,
      type: NOTIFICATION_TYPE.GENERIC,
      title: 'Branch closed tomorrow',
    };

    await service.create(adHoc);
    await service.create(adHoc);

    assert.equal(await prisma.notification.count(), 2);
  });
});
