import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NOTIFICATION_TYPE } from '@iace/contracts';
import { DeliveryChannel } from '@prisma/client';
import { NotificationsProcessor } from '../src/notifications/notifications.processor';
import { type NotificationDeliveryProcessor } from '../src/notifications/notification-delivery.processor';
import { type NotificationOutbox } from '../src/notifications/notification-outbox';
import { type NotificationsService } from '../src/notifications/notifications.service';
import { type PushService } from '../src/notifications/push.service';
import { type TestOpeningService } from '../src/notifications/test-opening.service';
import { type PrismaService } from '../src/prisma/prisma.service';
import { FakeQueue, fakeQueueFailures } from './support/fakes';

interface Row {
  id: string;
  payload: unknown;
  processedAt: Date | null;
}

const request = (id: string, over: Record<string, unknown> = {}): Row => ({
  id,
  payload: {
    studentId: `stu_${id}`,
    type: NOTIFICATION_TYPE.RESULT_READY,
    title: 'Your result is ready',
    dedupeKey: `result:${id}`,
    ...over,
  },
  processedAt: null,
});

function build(rows: Row[]) {
  const pages: { studentId: string }[][] = [];
  const singles: { studentId: string }[] = [];
  const pushed: string[] = [];
  const state = { failWrite: false };

  const prisma = {
    outboxEvent: {
      findMany: ({ take }: { take: number }) =>
        Promise.resolve(rows.filter((row) => row.processedAt === null).slice(0, take)),
      updateMany: ({
        where,
        data,
      }: {
        where: { id: { in: string[] } };
        data: { processedAt: Date };
      }) => {
        for (const row of rows.filter((candidate) => where.id.in.includes(candidate.id))) {
          row.processedAt = data.processedAt;
        }
        return Promise.resolve({ count: where.id.in.length });
      },
    },
    notificationDelivery: { findMany: () => Promise.resolve([]) },
  } as unknown as PrismaService;

  const notifications = {
    createMany: (inputs: readonly { studentId: string }[]) => {
      if (state.failWrite) return Promise.reject(new Error('postgres is down'));
      pages.push([...inputs]);
      return Promise.resolve(
        inputs.map((input, at) => ({
          id: `ntf_${at}`,
          studentId: input.studentId,
          type: '',
          title: '',
        })),
      );
    },
    create: (intent: { studentId: string }) => {
      singles.push(intent);
      return Promise.resolve({ id: 'ntf_paid' });
    },
  } as unknown as NotificationsService;

  const push = {
    deliver: (input: { notificationId: string }) => {
      pushed.push(input.notificationId);
      return Promise.resolve();
    },
  } as unknown as PushService;

  const processor = new NotificationsProcessor(
    prisma,
    notifications,
    { relay: () => Promise.resolve() } as unknown as NotificationOutbox,
    push,
    { sweep: () => Promise.resolve() } as unknown as TestOpeningService,
    { repairStalled: () => Promise.resolve() } as unknown as NotificationDeliveryProcessor,
    new FakeQueue().asQueue(),
    fakeQueueFailures(),
  );

  return { processor, rows, pages, singles, pushed, state };
}

const marked = (rows: Row[]) => rows.filter((row) => row.processedAt !== null).map((row) => row.id);

describe('NotificationsProcessor — one pass over a page of requests', () => {
  it('writes a hall of results in one page and pushes each of them', async () => {
    const built = build([request('a'), request('b'), request('c')]);

    const counted = await built.processor.writePending();

    assert.equal(counted, 3);
    assert.equal(built.pages.length, 1, 'one write, not one per request');
    assert.deepEqual(
      built.pages[0]?.map((row) => row.studentId),
      ['stu_a', 'stu_b', 'stu_c'],
    );
    assert.deepEqual(built.pushed, ['ntf_0', 'ntf_1', 'ntf_2']);
    assert.deepEqual(marked(built.rows), ['a', 'b', 'c']);
  });

  /** The hole this closes: a row marked when the job was QUEUED left a student nobody ever told. */
  it('marks nothing when the write throws', async () => {
    const built = build([request('a')]);
    built.state.failWrite = true;

    await assert.rejects(() => built.processor.writePending());

    assert.deepEqual(marked(built.rows), []);
  });

  it('claims nothing from a page it has already written', async () => {
    const built = build([request('a')]);

    await built.processor.writePending();

    assert.equal(await built.processor.writePending(), 0);
    assert.equal(built.pages.length, 1);
  });

  /** A request nothing can act on must not block every request behind it. */
  it('marks an unreadable request with the page and writes nothing for it', async () => {
    const built = build([
      { id: 'bad', payload: { nothing: true }, processedAt: null },
      request('a'),
    ]);

    await built.processor.writePending();

    assert.deepEqual(
      built.pages[0]?.map((row) => row.studentId),
      ['stu_a'],
    );
    assert.deepEqual(marked(built.rows), ['bad', 'a']);
  });

  /** The regression this prevents: one page a sweep meant a hall's results took half an hour. */
  it('drains a backlog rather than one page of it', async () => {
    const built = build(Array.from({ length: 450 }, (_, at) => request(`r${at}`)));

    const counted = await built.processor.writePending();

    assert.equal(counted, 450);
    assert.deepEqual(
      built.pages.map((page) => page.length),
      [200, 200, 50],
    );
    assert.equal(marked(built.rows).length, 450);
  });

  /** A paid send walks a fallback chain, so it keeps the one-at-a-time path the chain needs. */
  it('keeps an admin paid send off the page', async () => {
    const built = build([request('a'), request('b', { escalate: [DeliveryChannel.SMS] })]);

    await built.processor.writePending();

    assert.deepEqual(
      built.pages[0]?.map((row) => row.studentId),
      ['stu_a'],
    );
    assert.deepEqual(
      built.singles.map((intent) => intent.studentId),
      ['stu_b'],
    );
    assert.deepEqual(marked(built.rows), ['a', 'b']);
  });
});
