import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes, NOTIFICATION_TYPE } from '@iace/contracts';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NotificationsListener } from '../src/notifications/notifications.listener';
import { FakeNotificationsPrisma, type FakeNotificationRow } from './support/fakes';

/**
 * Notifications are a REACTION to something that already happened, so the two guarantees are:
 * the right row for each event, and a failure here never reaching the producer.
 */

const PAGE = { page: 1, pageSize: 20, unreadOnly: undefined };

function build(rows: FakeNotificationRow[] = []) {
  const prisma = new FakeNotificationsPrisma(rows);
  const service = new NotificationsService(prisma.asService());
  return { prisma, service, listener: new NotificationsListener(service) };
}

describe('NotificationsListener — one row per thing that happened', () => {
  it('writes an unlock the student can tap through to the series', async () => {
    const { listener, prisma } = build();

    await listener.onSeriesUnlocked({ studentId: 'stu_1', testSeriesId: 'srs_1' });

    const row = prisma.rows[0];
    assert.equal(row?.type, NOTIFICATION_TYPE.SERIES_UNLOCKED);
    assert.equal(row?.studentId, 'stu_1');
    assert.equal(row?.testSeriesId, 'srs_1');
    assert.equal(row?.isRead, false);
  });

  it('writes a grant the student can tap through to the series', async () => {
    const { listener, prisma } = build();

    await listener.onSeriesGranted({ studentId: 'stu_1', testSeriesId: 'srs_1' });

    assert.equal(prisma.rows[0]?.type, NOTIFICATION_TYPE.GRANT_ADDED);
    assert.equal(prisma.rows[0]?.testSeriesId, 'srs_1');
  });

  /** An enrolment opens whatever the exam reaches, which is not one series to link to. */
  it('writes an enrolment with no deep link, naming the exams that were added', async () => {
    const { listener, prisma } = build();

    await listener.onEnrolmentAdded({ studentId: 'stu_1', examCodes: ['SSC CGL', 'RRB JE'] });

    const row = prisma.rows[0];
    assert.equal(row?.type, NOTIFICATION_TYPE.ENROLLMENT_ADDED);
    assert.equal(row?.testSeriesId, null);
    assert.equal(row?.testId, null);
    assert.match(row?.body ?? '', /SSC CGL/);
  });

  /**
   * THE failure this prevents: the unlock already happened. A notification that cannot be written
   * must not take the write that caused it down with it.
   */
  it('swallows its own failure rather than failing the producer', async () => {
    const failing = {
      create: () => Promise.reject(new Error('postgres is down')),
    } as unknown as NotificationsService;
    const listener = new NotificationsListener(failing);

    await assert.doesNotReject(() =>
      listener.onSeriesUnlocked({ studentId: 'stu_1', testSeriesId: 'srs_1' }),
    );
    await assert.doesNotReject(() =>
      listener.onEnrolmentAdded({ studentId: 'stu_1', examCodes: ['SSC CGL'] }),
    );
    await assert.doesNotReject(() =>
      listener.onSeriesGranted({ studentId: 'stu_1', testSeriesId: 'srs_1' }),
    );
  });
});

describe('NotificationsService — one student’s own bell', () => {
  const twoStudents = () =>
    build([
      row({ id: 'ntf_1', studentId: 'stu_1' }),
      row({ id: 'ntf_2', studentId: 'stu_2' }),
      row({ id: 'ntf_3', studentId: 'stu_1', isRead: true }),
    ]);

  /** The id is never taken from the request, so there is no shape that reaches another student. */
  it('lists only what belongs to the student asking', async () => {
    const { service } = twoStudents();

    const page = await service.list('stu_1', PAGE);

    assert.deepEqual(
      page.items.map((item) => item.id),
      ['ntf_1', 'ntf_3'],
    );
    assert.equal(page.total, 2);
  });

  it('narrows to what has not been read yet', async () => {
    const { service } = twoStudents();

    const page = await service.list('stu_1', { ...PAGE, unreadOnly: true });

    assert.deepEqual(
      page.items.map((item) => item.id),
      ['ntf_1'],
    );
  });

  it('marks one row read and leaves the rest alone', async () => {
    const { service, prisma } = twoStudents();

    const marked = await service.markRead('stu_1', 'ntf_1');

    assert.equal(marked.isRead, true);
    assert.equal(prisma.rows.find((item) => item.id === 'ntf_1')?.isRead, true);
    assert.equal(prisma.rows.find((item) => item.id === 'ntf_2')?.isRead, false);
  });

  it('refuses to mark somebody else’s notification read', async () => {
    const { service, prisma } = twoStudents();

    const error = await service.markRead('stu_1', 'ntf_2').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
    assert.equal(prisma.rows.find((item) => item.id === 'ntf_2')?.isRead, false);
  });

  it('serialises the row the student screen reads', async () => {
    const { service } = build();

    const created = await service.create({
      studentId: 'stu_1',
      type: NOTIFICATION_TYPE.SERIES_UNLOCKED,
      title: 'A test series is now open',
      testSeriesId: 'srs_1',
    });

    assert.equal(typeof created.createdAt, 'string');
    assert.equal(created.body, null);
    assert.equal(created.testId, null);
  });
});

function row(overrides: Partial<FakeNotificationRow>): FakeNotificationRow {
  return {
    id: 'ntf_1',
    studentId: 'stu_1',
    type: NOTIFICATION_TYPE.GENERIC,
    title: 'Something happened',
    body: null,
    testId: null,
    testSeriesId: null,
    isRead: false,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}
