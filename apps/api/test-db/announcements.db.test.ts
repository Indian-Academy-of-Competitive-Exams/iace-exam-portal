import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  announcementAudienceSchema,
  createAnnouncementSchema,
  type AnnouncementChannel,
} from '@iace/contracts';
import { DeliveryChannel } from '@prisma/client';
import { AnnouncementsService } from '../src/notifications/announcements.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { type BroadcastPush } from '../src/notifications/push.service';
import { NOTIFICATION_JOBS, announceJobId } from '../src/queue/queues';
import { FakeConfig, FakeQueue } from '../test/support/fakes';
import {
  makeAdmin,
  makeAnnouncement,
  makeBranch,
  makeNotification,
  makeStudent,
  resetDatabase,
  testPrisma,
  uid,
} from './support/database';
import { sheetRows } from './support/workbook';

/** Sending one spends money, so the guarantees are: the count is right, and the cap is a wall. */

const prisma = testPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
  queue.jobs.length = 0;
  pushed.length = 0;
});
after(() => prisma.$disconnect());

const queue = new FakeQueue();
const pushed: { studentIds: string[]; message: BroadcastPush }[] = [];
const service = new AnnouncementsService(
  prisma,
  new FakeConfig({
    NOTIFICATION_COST_WHATSAPP_PAISE: 17,
    NOTIFICATION_COST_SMS_PAISE: 18,
    NOTIFICATION_MAX_RECIPIENTS: 10,
  }).asService(),
  new NotificationsService(prisma),
  {
    broadcast: (studentIds: readonly string[], message: BroadcastPush) => {
      pushed.push({ studentIds: [...studentIds], message });
      return Promise.resolve();
    },
  } as never,
  queue.asQueue(),
);

/** One branch of `students`, and an admin to send as. Parsed through the real schema's defaults. */
async function branchOf(students = 3) {
  const branch = await makeBranch(prisma);
  const admin = await makeAdmin(prisma);
  const roster = [];
  for (let i = 0; i < students; i += 1) {
    roster.push(await makeStudent(prisma, { currentBranchId: branch.id }));
  }
  const audience = announcementAudienceSchema.parse({ branchId: [branch.id] });
  const draft = (paidChannels: AnnouncementChannel[] = []) =>
    createAnnouncementSchema.parse({
      title: 'Branch closed tomorrow',
      body: 'The Ameerpet centre is shut on Friday.',
      audience: { branchId: [branch.id] },
      paidChannels,
    });
  return { admin, roster, audience, draft };
}

const messagesWritten = () => prisma.notification.findMany();

describe('Pricing an announcement before it is sent', () => {
  it('costs nothing when it is in-app only', async () => {
    const { audience } = await branchOf();

    const priced = await service.preview(audience, []);

    assert.equal(priced.recipientCount, 3);
    assert.equal(priced.estimatedCostPaise, 0);
  });

  /** The FIRST channel is what everyone gets; the rest are only what a failure falls back to. */
  it('prices the leading channel only, not the whole chain', async () => {
    const { audience } = await branchOf();

    const priced = await service.preview(audience, ['WHATSAPP', 'SMS']);

    assert.equal(priced.estimatedCostPaise, 3 * 17, 'SMS is a fallback, not a second message');
  });
});

describe('Sending an announcement', () => {
  /** THE failure this prevents: a send to 42K students writing 42K rows while the admin waits. */
  it('records the send and queues its delivery, writing no message on the request', async () => {
    const { admin, draft } = await branchOf();

    const sent = await service.send(draft(), admin.id);

    assert.equal(sent.recipientCount, 3);
    assert.equal((await messagesWritten()).length, 0);
    assert.deepEqual(
      queue.jobs.map((job) => [job.name, job.jobId]),
      [[NOTIFICATION_JOBS.ANNOUNCE, announceJobId(sent.id)]],
    );
  });

  /** The failure this prevents: a mistargeted broadcast becoming an invoice instead of an error. */
  it('refuses a cohort larger than one send may reach', async () => {
    const { admin, draft } = await branchOf(11);

    const error = await service.send(draft(), admin.id).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.equal(await prisma.announcement.count(), 0, 'and nothing was written');
  });

  it('refuses a cohort of nobody rather than recording an empty send', async () => {
    const { admin, draft } = await branchOf(0);

    await assert.rejects(service.send(draft(), admin.id), /reaches nobody/);
  });
});

describe('Delivering a sent announcement', () => {
  /** In-app only is one row for everybody: the bell resolves it, so the worker only pushes. */
  it('pushes an in-app send to its cohort and copies it to nobody', async () => {
    const { admin, roster, draft } = await branchOf();
    const sent = await service.send(draft(), admin.id);

    await service.deliver(sent.id);

    assert.deepEqual(
      pushed.flatMap((page) => page.studentIds).sort(),
      roster.map((s) => s.id).sort(),
    );
    assert.equal(pushed[0]?.message.broadcastId, sent.id);
    assert.equal((await messagesWritten()).length, 0);
  });

  /** What the admin chose to spend on IS the fallback chain, and each message is billed, so it is a row. */
  it('writes one message per recipient of a paid send, tied to it, and none twice when replayed', async () => {
    const { admin, draft } = await branchOf(2);
    const sent = await service.send(draft(['WHATSAPP', 'SMS']), admin.id);

    await service.deliver(sent.id);
    await service.deliver(sent.id);

    const messages = await messagesWritten();
    assert.equal(messages.length, 2);
    assert.ok(messages.every((message) => message.announcementId === sent.id));
    assert.deepEqual(pushed, []);
  });

  it('reaches nobody who joined after it was sent', async () => {
    const { admin, draft } = await branchOf(1);
    const sent = await service.send(draft(['SMS']), admin.id);
    const branchId = draft().audience.branchId?.[0] ?? null;
    await makeStudent(prisma, {
      currentBranchId: branchId,
      createdAt: new Date(Date.now() + 60_000),
    });

    await service.deliver(sent.id);

    assert.equal((await messagesWritten()).length, 1);
  });
});

describe('Sending the same notice again', () => {
  /** "Send again" rebuilds nothing: it reads back the filter the first send recorded. */
  it('reads the audience back off a sent announcement', async () => {
    const { admin, audience, draft } = await branchOf();

    const sent = await service.send(draft(), admin.id);
    const page = await service.list({ page: 1, pageSize: 20, q: undefined });

    assert.deepEqual(sent.audience, audience);
    assert.deepEqual(
      page.items[0]?.audience,
      audience,
      'and the list carries it, not just the detail',
    );
  });

  /** Each send is its own row, so the history stays honest about who was told what, and when. */
  it('records a second row rather than editing the first', async () => {
    const { admin, draft } = await branchOf();

    await service.send(draft(), admin.id);
    await service.send(draft(), admin.id);

    assert.equal(await prisma.announcement.count(), 2);
  });
});

describe("Exporting an announcement's deliveries", () => {
  async function toldOver(announcementId: string, channels: DeliveryChannel[], fullName: string) {
    const student = await makeStudent(prisma, { fullName });
    const { id } = await makeNotification(prisma, { studentId: student.id });
    await prisma.notification.update({ where: { id }, data: { announcementId } });
    await prisma.notificationDelivery.createMany({
      data: channels.map((channel) => ({ notificationId: id, channel })),
    });
  }

  it('writes one row per notification and channel of that announcement, and none of another', async () => {
    const announcement = await makeAnnouncement(prisma);
    const other = await makeAnnouncement(prisma);
    await toldOver(announcement.id, [DeliveryChannel.IN_APP, DeliveryChannel.SMS], 'Asha');
    await toldOver(announcement.id, [DeliveryChannel.IN_APP], 'Bala');
    await toldOver(other.id, [DeliveryChannel.IN_APP, DeliveryChannel.SMS], 'Chitra');

    const { workbook, rows } = await service.exportDeliveries(announcement.id);
    const sheet = await sheetRows(workbook);

    assert.equal(rows, 3);
    assert.deepEqual(sheet.map((row) => `${String(row.Student)} ${String(row.Channel)}`).sort(), [
      'Asha IN_APP',
      'Asha SMS',
      'Bala IN_APP',
    ]);
  });

  it('refuses an announcement that does not exist', async () => {
    await assert.rejects(service.exportDeliveries(uid()), { code: ErrorCodes.NOT_FOUND });
  });
});

describe('Listing announcements', () => {
  it('narrows by channel, with in-app only as a channel of its own, and by the words in it', async () => {
    const inApp = await makeAnnouncement(prisma);
    const bySms = await makeAnnouncement(prisma, [DeliveryChannel.SMS]);
    await prisma.announcement.update({ where: { id: bySms.id }, data: { title: 'Fee reminder' } });
    const ids = async (narrowed: object) =>
      (await service.list({ page: 1, pageSize: 20, q: undefined, ...narrowed })).items.map(
        (row) => row.id,
      );

    assert.deepEqual(await ids({ channel: ['IN_APP_ONLY'] }), [inApp.id]);
    assert.deepEqual(await ids({ channel: ['SMS'] }), [bySms.id]);
    assert.deepEqual(await ids({ q: 'fee' }), [bySms.id]);
    assert.deepEqual((await ids({ channel: ['IN_APP_ONLY', 'SMS'] })).length, 2);
  });
});
