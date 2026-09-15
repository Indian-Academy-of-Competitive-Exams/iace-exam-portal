import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  announcementAudienceSchema,
  createAnnouncementSchema,
  type AnnouncementChannel,
} from '@iace/contracts';
import { AnnouncementsService } from '../src/notifications/announcements.service';
import { NOTIFICATION_REQUEST, NotificationOutbox } from '../src/notifications/notification-outbox';
import { FakeConfig, FakeQueue } from '../test/support/fakes';
import { makeAdmin, makeBranch, makeStudent, resetDatabase, testPrisma } from './support/database';

/** Sending one spends money, so the guarantees are: the count is right, and the cap is a wall. */

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const service = new AnnouncementsService(
  prisma,
  new FakeConfig({
    NOTIFICATION_COST_WHATSAPP_PAISE: 17,
    NOTIFICATION_COST_SMS_PAISE: 18,
    NOTIFICATION_MAX_RECIPIENTS: 10,
  }).asService(),
  new NotificationOutbox(new FakeQueue().asQueue()),
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

const requestsWritten = () =>
  prisma.outboxEvent.findMany({ where: { eventType: NOTIFICATION_REQUEST.EVENT_TYPE } });

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

  /** A student with no number on file cannot be reached by a paid channel, so nobody pays for them. */
  it('prices only the students a paid channel could reach', async () => {
    const { audience, roster } = await branchOf();
    await prisma.student.update({ where: { id: roster[0]?.id ?? '' }, data: { mobile: '' } });

    const priced = await service.preview(audience, ['WHATSAPP']);

    assert.equal(priced.recipientCount, 3);
    assert.equal(priced.reachableCount, 2);
    assert.equal(priced.estimatedCostPaise, 2 * 17);
  });
});

describe('Sending an announcement', () => {
  it('writes the record and one request per recipient, together', async () => {
    const { admin, draft } = await branchOf();

    await service.send(draft(), admin.id);

    assert.equal(await prisma.announcement.count(), 1);
    assert.equal((await requestsWritten()).length, 3, 'one request per student in the cohort');
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

  /** What the admin chose to spend on IS the fallback chain for every message in the send. */
  it('carries the chosen channels onto every request', async () => {
    const { admin, draft } = await branchOf(2);

    const sent = await service.send(draft(['WHATSAPP', 'SMS']), admin.id);

    const requests = await requestsWritten();
    assert.equal(requests.length, 2);
    for (const event of requests) {
      const payload = event.payload as { escalate?: string[]; announcementId?: string };
      assert.deepEqual(payload.escalate, ['WHATSAPP', 'SMS']);
      assert.equal(payload.announcementId, sent.id);
    }
  });
});

describe('Sending the same notice again', () => {
  /** "Send again" rebuilds nothing: it reads back the filter the first send recorded. */
  it('reads the audience back off a sent announcement', async () => {
    const { admin, audience, draft } = await branchOf();

    const sent = await service.send(draft(), admin.id);
    const page = await service.list({ page: 1, pageSize: 20 });

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
