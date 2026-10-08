import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { AppException, ErrorCodes, NOTIFICATION_TYPE } from '@iace/contracts';
import { NotificationsService } from '../src/notifications/notifications.service';
import {
  makeCatalog,
  makeNotification,
  makeStudent,
  resetDatabase,
  testPrisma,
} from './support/database';

/** A notification is written with the fact it tells of, so the guarantee is one row per fact. */

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

    await service.tell(prisma, {
      studentId: student.id,
      type: NOTIFICATION_TYPE.GRANT_ADDED,
      title: 'A test series was added to your account',
      testSeriesId,
    });

    const [created] = (await service.list(student.id, PAGE)).items;
    assert.ok(created);
    assert.equal(typeof created.createdAt, 'string');
    assert.equal(created.body, null);
    assert.equal(created.testId, null);
  });
});

describe('NotificationsService — paging by cursor', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 5, 1, 0, minute));

  /** Five unread rows, newest first: the list a student pages down. */
  async function fiveUnread(sameInstant = false) {
    const me = await makeStudent(prisma);
    const rows: { id: string }[] = [];
    for (let minute = 0; minute < 5; minute++) {
      rows.push(
        await makeNotification(prisma, {
          studentId: me.id,
          createdAt: at(sameInstant ? 0 : minute),
        }),
      );
    }
    return { me, rows };
  }

  const idsOf = (page: { items: { id: string }[] }) => page.items.map((item) => item.id);

  /** The failure this prevents: rows read between two loads shrink the unread set, and a position-cut page skips as many. */
  it('skips and repeats nothing when rows are read between page loads', async () => {
    const { me, rows } = await fiveUnread();
    const [newest, second, third, fourth, oldest] = [...rows].reverse().map((row) => row.id);
    const unread = { ...PAGE, pageSize: 2, unreadOnly: true };

    const first = await service.list(me.id, unread);
    assert.deepEqual(idsOf(first), [newest, second]);
    for (const id of idsOf(first)) await service.markRead(me.id, id);

    const next = await service.list(me.id, { ...unread, page: 2, cursor: second });
    assert.deepEqual(idsOf(next), [third, fourth]);
    assert.equal(next.total, 3);

    const last = await service.list(me.id, { ...unread, page: 3, cursor: fourth });
    assert.deepEqual(idsOf(last), [oldest]);
  });

  /** Rows written in one statement share an instant, so the id is what keeps the order total. */
  it('walks rows that share a creation instant exactly once', async () => {
    const { me, rows } = await fiveUnread(true);
    const everyId = rows
      .map((row) => row.id)
      .sort()
      .reverse();
    const seen: string[] = [];

    for (let cursor: string | undefined; ;) {
      const page = await service.list(me.id, { ...PAGE, pageSize: 2, cursor });
      if (page.items.length === 0) break;
      seen.push(...idsOf(page));
      cursor = page.items.at(-1)?.id;
    }

    assert.deepEqual(seen, everyId);
  });

  it('answers a caller that sends no cursor as it always has', async () => {
    const { me, rows } = await fiveUnread();
    const newestFirst = [...rows].reverse().map((row) => row.id);

    const second = await service.list(me.id, { ...PAGE, page: 2, pageSize: 2 });

    assert.deepEqual(idsOf(second), newestFirst.slice(2, 4));
    assert.equal(second.page, 2);
    assert.equal(second.total, 5);
  });
});

describe('Telling a student', () => {
  /** No delivery row either: the notification itself IS the in-app delivery, and paying is a per-send choice. */
  it('writes the row they read at once, for every kind, booking nothing', async () => {
    const student = await makeStudent(prisma);

    for (const type of Object.values(NOTIFICATION_TYPE)) {
      await service.tell(prisma, { studentId: student.id, type, title: 'Something happened' });
    }

    assert.equal(
      (await service.list(student.id, PAGE)).total,
      Object.values(NOTIFICATION_TYPE).length,
    );
    assert.equal(await prisma.notificationDelivery.count(), 0);
  });

  /** The failure this prevents: a student told of a grant, a result or an enrolment that never committed. */
  it('commits or rolls back with the write that caused it', async () => {
    const student = await makeStudent(prisma);

    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await service.tell(tx, {
          studentId: student.id,
          type: NOTIFICATION_TYPE.GRANT_ADDED,
          title: 'A test series was added to your account',
        });
        throw new Error('the grant failed');
      }),
      /the grant failed/,
    );

    assert.equal(await prisma.notification.count(), 0);
  });

  /** What makes a replayed fact harmless: a re-scored sitting does not ring the bell twice. */
  it('writes one row when the same fact arrives twice', async () => {
    const student = await makeStudent(prisma);
    const fact = {
      studentId: student.id,
      type: NOTIFICATION_TYPE.RESULT_READY,
      title: 'Your result is ready',
      dedupeKey: 'result:att_1',
    };

    await service.tell(prisma, fact);
    await service.tell(prisma, fact);

    assert.equal(await prisma.notification.count(), 1);
  });

  /** An ad-hoc announcement has no natural key, so saying it twice must remain possible. */
  it('lets a keyless notification repeat', async () => {
    const student = await makeStudent(prisma);
    const adHoc = {
      studentId: student.id,
      type: NOTIFICATION_TYPE.GENERIC,
      title: 'Branch closed tomorrow',
    };

    await service.tell(prisma, adHoc);
    await service.tell(prisma, adHoc);

    assert.equal(await prisma.notification.count(), 2);
  });
});
