import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DeliveryChannel } from '@prisma/client';
import { AppException, ErrorCodes, NOTIFICATION_TYPE } from '@iace/contracts';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NotificationsListener } from '../src/notifications/notifications.listener';
import {
  FakeMessageSender,
  FakeNotificationsPrisma,
  type FakeNotificationRow,
} from './support/fakes';

/**
 * Notifications are a REACTION to something that already happened, so the two guarantees are:
 * the right row for each event, and a failure here never reaching the producer.
 */

const PAGE = { page: 1, pageSize: 20, unreadOnly: undefined };

function build(rows: FakeNotificationRow[] = [], mobiles: Record<string, string> = {}) {
  const prisma = new FakeNotificationsPrisma(rows, mobiles);
  const service = new NotificationsService(prisma.asService());
  const sender = new FakeMessageSender();
  return { prisma, service, sender, listener: new NotificationsListener(service, sender) };
}

describe('NotificationsListener — one row per thing that happened', () => {
  it('tells a student their result is ready, in the bell and by SMS', async () => {
    const { listener, prisma, sender } = build([], { stu_1: '9876543210' });

    await listener.onScoringCompleted({
      attemptId: 'att_1',
      testId: 'tst_1',
      studentId: 'stu_1',
      isGraded: true,
    });

    assert.equal(prisma.rows[0]?.type, NOTIFICATION_TYPE.RESULT_READY);
    assert.equal(prisma.rows[0]?.testId, 'tst_1');
    assert.equal(sender.lastMessage.kind, 'result_ready');
    assert.equal(sender.lastMessage.to, '9876543210');
  });

  /** An anonymised student still has sittings, and nothing is left to text. */
  it('writes the bell and sends nothing when there is no number to reach', async () => {
    const { listener, prisma, sender } = build();

    await listener.onScoringCompleted({
      attemptId: 'att_1',
      testId: 'tst_1',
      studentId: 'stu_1',
      isGraded: true,
    });

    assert.equal(prisma.rows.length, 1);
    assert.equal(sender.sent.length, 0);
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
    const listener = new NotificationsListener(failing, new FakeMessageSender());

    await assert.doesNotReject(() =>
      listener.onEnrolmentAdded({ studentId: 'stu_1', examCodes: ['SSC CGL'] }),
    );
    await assert.doesNotReject(() =>
      listener.onSeriesGranted({ studentId: 'stu_1', testSeriesId: 'srs_1' }),
    );
    await assert.doesNotReject(() =>
      listener.onScoringCompleted({
        attemptId: 'att_1',
        testId: 'tst_1',
        studentId: 'stu_1',
        isGraded: true,
      }),
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
      type: NOTIFICATION_TYPE.GRANT_ADDED,
      title: 'A test series was added to your account',
      testSeriesId: 'srs_1',
    });

    assert.equal(typeof created.createdAt, 'string');
    assert.equal(created.body, null);
    assert.equal(created.testId, null);
  });
});

describe('Writing a notification books what may be spent on it', () => {
  it('books the channel the policy leads with', async () => {
    const { service, prisma } = build();

    await service.create({
      studentId: 'stu_1',
      type: NOTIFICATION_TYPE.RESULT_READY,
      title: 'Your result is ready',
    });

    assert.deepEqual(
      prisma.deliveries.map((delivery) => delivery.channel),
      [DeliveryChannel.WHATSAPP],
    );
  });

  /** The escalate list is a FALLBACK chain: booking it all at once would buy both messages. */
  it('books only the first of a chain, never the whole of it', async () => {
    const { service, prisma } = build();

    await service.create({
      studentId: 'stu_1',
      type: NOTIFICATION_TYPE.TEST_ASSIGNED,
      title: 'A test has been assigned',
    });

    assert.deepEqual(
      prisma.deliveries.map((delivery) => delivery.channel),
      [DeliveryChannel.WHATSAPP],
      'SMS is what WhatsApp falls back TO, not something sent beside it',
    );
  });

  /** No IN_APP row: the notification itself IS that delivery, and mirroring it doubles the table. */
  it('books nothing for a kind that never justifies paying', async () => {
    const { service, prisma } = build();

    await service.create({
      studentId: 'stu_1',
      type: NOTIFICATION_TYPE.ENROLLMENT_ADDED,
      title: 'You have been enrolled',
    });

    assert.equal(prisma.rows.length, 1);
    assert.equal(prisma.deliveries.length, 0);
  });

  /** What makes the outbox safe to redeliver: the loser reads back the row it lost to. */
  it('writes one row when the same fact arrives twice', async () => {
    const { service, prisma } = build();
    const fact = {
      studentId: 'stu_1',
      type: NOTIFICATION_TYPE.RESULT_READY,
      title: 'Your result is ready',
      dedupeKey: 'result:att_1',
    };

    const first = await service.create(fact);
    const second = await service.create(fact);

    assert.equal(prisma.rows.length, 1);
    assert.equal(second.id, first.id, 'the redelivery reads back the row it lost to');
    assert.equal(prisma.deliveries.length, 1, 'and does not book a second paid message');
  });

  /** An ad-hoc announcement has no natural key, so saying it twice must remain possible. */
  it('lets a keyless notification repeat', async () => {
    const { service, prisma } = build();
    const adHoc = {
      studentId: 'stu_1',
      type: NOTIFICATION_TYPE.GENERIC,
      title: 'Branch closed tomorrow',
    };

    await service.create(adHoc);
    await service.create(adHoc);

    assert.equal(prisma.rows.length, 2);
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
