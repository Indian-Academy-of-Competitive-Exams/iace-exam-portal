import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  NOTIFICATION_TYPE,
  notificationListQuerySchema,
  TEST_SERIES_KIND,
  type AnnouncementAudience,
} from '@iace/contracts';
import { AccessResolverService } from '../src/reach/access-resolver.service';
import { BellService } from '../src/notifications/bell.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { FakeRedis } from '../test/support/fakes';
import {
  makeAdmin,
  makeBranch,
  makeCatalog,
  makeNotification,
  makeStudent,
  makeTest,
  resetDatabase,
  testPrisma,
} from './support/database';

/** A notification is written with the fact it tells of, so the guarantee is one row per fact. */

const PAGE = { page: 1, pageSize: 20, unreadOnly: undefined, q: undefined };

const prisma = testPrisma();
const service = new NotificationsService(prisma);
const bell = new BellService(
  prisma,
  new AccessResolverService(prisma, new FakeRedis().asService()),
);

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

    const page = await bell.list(me.id, PAGE);

    assert.deepEqual(
      page.items.map((item) => item.id),
      [newer.id, older.id],
    );
    assert.equal(page.total, 2);
  });

  it('narrows to what has not been read yet', async () => {
    const { me, newer } = await twoStudents();

    const page = await bell.list(me.id, { ...PAGE, unreadOnly: true });

    assert.deepEqual(
      page.items.map((item) => item.id),
      [newer.id],
    );
  });

  it('marks one row read and leaves the rest alone', async () => {
    const { me, newer, theirs } = await twoStudents();

    const marked = await bell.markRead(me.id, newer.id);

    assert.equal(marked.isRead, true);
    assert.equal(await readOf(newer.id), true);
    assert.equal(await readOf(theirs.id), false);
  });

  it('refuses to mark somebody else’s notification read', async () => {
    const { me, theirs } = await twoStudents();

    const error = await bell.markRead(me.id, theirs.id).catch((e: unknown) => e);

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

    const [created] = (await bell.list(student.id, PAGE)).items;
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

    const first = await bell.list(me.id, unread);
    assert.deepEqual(idsOf(first), [newest, second]);
    for (const id of idsOf(first)) await bell.markRead(me.id, id);

    const next = await bell.list(me.id, { ...unread, page: 2, cursor: second });
    assert.deepEqual(idsOf(next), [third, fourth]);
    assert.equal(next.total, 3);

    const last = await bell.list(me.id, { ...unread, page: 3, cursor: fourth });
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
      const page = await bell.list(me.id, { ...PAGE, pageSize: 2, cursor });
      if (page.items.length === 0) break;
      seen.push(...idsOf(page));
      cursor = page.items.at(-1)?.id;
    }

    assert.deepEqual(seen, everyId);
  });

  it('answers a caller that sends no cursor as it always has', async () => {
    const { me, rows } = await fiveUnread();
    const newestFirst = [...rows].reverse().map((row) => row.id);

    const second = await bell.list(me.id, { ...PAGE, page: 2, pageSize: 2 });

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
      (await bell.list(student.id, PAGE)).total,
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

describe('NotificationsService — narrowing the bell', () => {
  it('narrows by type, by the words in it and by the day it arrived at the institute', async () => {
    const me = await makeStudent(prisma);
    const result = await makeNotification(prisma, {
      studentId: me.id,
      type: NOTIFICATION_TYPE.RESULT_READY,
      title: 'Your SSC result is ready',
      createdAt: new Date('2026-06-01T10:00:00.000Z'),
    });
    // 01:30 on 2 June in Asia/Kolkata, though still 1 June in UTC.
    const holiday = await makeNotification(prisma, {
      studentId: me.id,
      title: 'Holiday on Friday',
      createdAt: new Date('2026-06-01T20:00:00.000Z'),
    });
    const ids = async (narrowed: object) =>
      (await bell.list(me.id, { ...PAGE, ...narrowed })).items.map((row) => row.id);

    assert.deepEqual(await ids({ type: [NOTIFICATION_TYPE.RESULT_READY] }), [result.id]);
    assert.deepEqual(await ids({ q: 'holiday' }), [holiday.id]);
    assert.deepEqual(await ids({ from: '2026-06-02', to: '2026-06-02' }), [holiday.id]);
    assert.deepEqual(await ids({ to: '2026-06-01' }), [result.id]);
  });

  /** The failure this prevents: page one read on sight leaves Unread, and page two skips as many rows. */
  it('keeps a row read since the list opened under Unread, so the next page does not skip one', async () => {
    const me = await makeStudent(prisma);
    const [oldest, middle, newest] = [
      await makeNotification(prisma, {
        studentId: me.id,
        createdAt: new Date('2026-06-01T01:00:00.000Z'),
      }),
      await makeNotification(prisma, {
        studentId: me.id,
        createdAt: new Date('2026-06-01T02:00:00.000Z'),
      }),
      await makeNotification(prisma, {
        studentId: me.id,
        createdAt: new Date('2026-06-01T03:00:00.000Z'),
      }),
    ];
    const unread = { ...PAGE, pageSize: 1, unreadOnly: true, unreadAsOf: new Date().toISOString() };

    const first = await bell.list(me.id, unread);
    assert.deepEqual(
      first.items.map((row) => row.id),
      [newest.id],
    );
    await bell.markRead(me.id, newest.id);

    const second = await bell.list(me.id, { ...unread, page: 2 });
    assert.deepEqual(
      second.items.map((row) => row.id),
      [middle.id],
    );
    assert.equal(second.total, 3);
    assert.notEqual(second.items[0]?.id, oldest.id);
  });
});

describe('BellService — a broadcast is resolved, never copied', () => {
  const unread = { ...PAGE, unreadOnly: true };

  /** An in-app announcement to one branch, sent now: one row for everybody it reaches. */
  async function announcementTo(
    audience: AnnouncementAudience,
    at = new Date(),
    title = 'Branch closed on Friday',
  ) {
    const admin = await makeAdmin(prisma);
    return prisma.announcement.create({
      data: {
        title,
        body: 'Classes move online.',
        audience,
        paidChannels: [],
        recipientCount: 1,
        estimatedCostPaise: 0,
        createdById: admin.id,
        createdAt: at,
      },
    });
  }

  /** THE failure this prevents: an announcement to 1L students written as 1L rows. */
  it('lists an announcement to the students its audience matches, and writes nothing per student', async () => {
    const north = await makeBranch(prisma);
    const [inside, outside] = [
      await makeStudent(prisma, {
        currentBranchId: north.id,
        createdAt: new Date(Date.now() - 60_000),
      }),
      await makeStudent(prisma, { createdAt: new Date(Date.now() - 60_000) }),
    ];
    const sent = await announcementTo({
      branchId: [north.id],
      match: 'all',
    } as AnnouncementAudience);

    assert.deepEqual(
      (await bell.list(inside.id, PAGE)).items.map((item) => item.id),
      [sent.id],
    );
    assert.equal((await bell.list(outside.id, PAGE)).total, 0);
    assert.equal(await prisma.notification.count(), 0);
  });

  it('never shows a student one sent before they joined', async () => {
    const sent = await announcementTo(
      { match: 'all' } as AnnouncementAudience,
      new Date(Date.now() - 60_000),
    );
    const joinedAfter = await makeStudent(prisma);

    assert.equal((await bell.list(joinedAfter.id, PAGE)).total, 0);
    assert.ok(sent.id);
  });

  it('marks one read for that student alone, by a row of its own', async () => {
    const [me, other] = [
      await makeStudent(prisma, { createdAt: new Date(Date.now() - 60_000) }),
      await makeStudent(prisma, { createdAt: new Date(Date.now() - 60_000) }),
    ];
    const sent = await announcementTo({ match: 'all' } as AnnouncementAudience);

    const marked = await bell.markRead(me.id, sent.id);

    assert.equal(marked.isRead, true);
    assert.equal((await bell.list(me.id, unread)).total, 0);
    assert.equal((await bell.list(other.id, unread)).total, 1);
    assert.equal(await prisma.broadcastRead.count(), 1);
  });

  it('refuses to mark read a broadcast that does not reach the student', async () => {
    const north = await makeBranch(prisma);
    const outside = await makeStudent(prisma, { createdAt: new Date(Date.now() - 60_000) });
    const sent = await announcementTo({
      branchId: [north.id],
      match: 'all',
    } as AnnouncementAudience);

    const error = await bell.markRead(outside.id, sent.id).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  it('lists a test opened in a series the student reaches, and not one in a series they do not', async () => {
    const me = await makeStudent(prisma, { createdAt: new Date(Date.now() - 60_000) });
    const free = await makeCatalog(prisma);
    await prisma.testSeries.update({
      where: { id: free.testSeriesId },
      data: { kind: TEST_SERIES_KIND.FREE },
    });
    const reached = await makeTest(prisma, free, { title: 'Mock 7' });
    const unreached = await makeTest(prisma, await makeCatalog(prisma), { title: 'Mock 8' });
    for (const test of [reached, unreached]) {
      await prisma.test.update({ where: { id: test.id }, data: { announcedAt: new Date() } });
    }

    // A fresh resolver: these series were written straight to the table, past the catalog's epoch.
    const fresh = new BellService(
      prisma,
      new AccessResolverService(prisma, new FakeRedis().asService()),
    );
    const [opened, ...rest] = (await fresh.list(me.id, PAGE)).items;

    assert.deepEqual(rest, []);
    assert.equal(opened?.id, reached.id);
    assert.equal(opened?.type, NOTIFICATION_TYPE.TEST_ASSIGNED);
    assert.equal(opened?.testSeriesId, free.testSeriesId);
  });

  /** A copy written before broadcasts were resolved stands for it, so nobody sees one twice. */
  it('shows a broadcast the student already holds a copy of only once, as that copy', async () => {
    const me = await makeStudent(prisma, { createdAt: new Date(Date.now() - 60_000) });
    const sent = await announcementTo({ match: 'all' } as AnnouncementAudience);
    const copy = await prisma.notification.create({
      data: {
        studentId: me.id,
        type: NOTIFICATION_TYPE.GENERIC,
        title: sent.title,
        announcementId: sent.id,
      },
    });

    assert.deepEqual(
      (await bell.list(me.id, PAGE)).items.map((item) => item.id),
      [copy.id],
    );
  });

  /** The failure this prevents: a search that finds a % or _ in an own row but not the same text in a broadcast. */
  it('finds a broadcast by a search holding a % or _, as it finds an own row', async () => {
    const me = await makeStudent(prisma, { createdAt: new Date(Date.now() - 60_000) });
    const own = await makeNotification(prisma, { studentId: me.id, title: 'Fees: 50% off' });
    const sent = await announcementTo(
      { match: 'all' } as AnnouncementAudience,
      new Date(),
      '50% off',
    );
    const named = await announcementTo({ match: 'all' } as AnnouncementAudience, new Date(), 'a_b');
    const ids = async (q: string) =>
      (await bell.list(me.id, notificationListQuerySchema.parse({ q }))).items.map((row) => row.id);

    assert.deepEqual((await ids('50%')).sort(), [own.id, sent.id].sort());
    assert.deepEqual(await ids('a_b'), [named.id]);
    assert.deepEqual(await ids('a%b'), []);
  });

  it('pages one list of rows and broadcasts by cursor, newest first, each once', async () => {
    const me = await makeStudent(prisma, { createdAt: new Date(Date.now() - 600_000) });
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    const oldRow = await makeNotification(prisma, { studentId: me.id, createdAt: minutesAgo(4) });
    const broadcast = await announcementTo({ match: 'all' } as AnnouncementAudience, minutesAgo(3));
    const newRow = await makeNotification(prisma, { studentId: me.id, createdAt: minutesAgo(2) });

    const first = await bell.list(me.id, { ...PAGE, pageSize: 2 });
    const next = await bell.list(me.id, {
      ...PAGE,
      pageSize: 2,
      page: 2,
      cursor: first.items.at(-1)?.id,
    });

    assert.deepEqual(
      first.items.map((item) => item.id),
      [newRow.id, broadcast.id],
    );
    assert.deepEqual(
      next.items.map((item) => item.id),
      [oldRow.id],
    );
    assert.equal(first.total, 3);
  });
});
