import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  announcementAudienceSchema,
  createAnnouncementSchema,
  type AnnouncementChannel,
} from '@iace/contracts';
import { AnnouncementsService } from '../src/notifications/announcements.service';
import { FakeAnnouncementsPrisma, FakeConfig, fakeNotificationOutbox } from './support/fakes';

/** Sending one spends money, so the guarantees are: the count is right, and the cap is a wall. */

/** Parsed through the real schema, so the test exercises the defaults a request would carry. */
const AUDIENCE = announcementAudienceSchema.parse({ branchId: ['brn_1'] });

const draft = (paidChannels: AnnouncementChannel[] = []) =>
  createAnnouncementSchema.parse({
    title: 'Branch closed tomorrow',
    body: 'The Ameerpet centre is shut on Friday.',
    audience: { branchId: ['brn_1'] },
    paidChannels,
  });

function build(students = 3) {
  const prisma = new FakeAnnouncementsPrisma(students);
  const config = new FakeConfig({
    NOTIFICATION_COST_WHATSAPP_PAISE: 17,
    NOTIFICATION_COST_SMS_PAISE: 18,
    NOTIFICATION_MAX_RECIPIENTS: 10,
  });
  const outbox = fakeNotificationOutbox(prisma);
  return {
    prisma,
    service: new AnnouncementsService(prisma.asService(), config.asService(), outbox),
  };
}

describe('Pricing an announcement before it is sent', () => {
  it('costs nothing when it is in-app only', async () => {
    const { service } = build();

    const priced = await service.preview(AUDIENCE, []);

    assert.equal(priced.recipientCount, 3);
    assert.equal(priced.estimatedCostPaise, 0);
  });

  /** The FIRST channel is what everyone gets; the rest are only what a failure falls back to. */
  it('prices the leading channel only, not the whole chain', async () => {
    const { service } = build();

    const priced = await service.preview(AUDIENCE, ['WHATSAPP', 'SMS']);

    assert.equal(priced.estimatedCostPaise, 3 * 17, 'SMS is a fallback, not a second message');
  });

  /** A student with no number on file cannot be reached by a paid channel, so nobody pays for them. */
  it('prices only the students a paid channel could reach', async () => {
    const { prisma, service } = build();
    prisma.students.slice(0, 1).forEach((row) => (row.mobile = ''));

    const priced = await service.preview(AUDIENCE, ['WHATSAPP']);

    assert.equal(priced.recipientCount, 3);
    assert.equal(priced.reachableCount, 2);
    assert.equal(priced.estimatedCostPaise, 2 * 17);
  });
});

describe('Sending an announcement', () => {
  it('writes the record and one request per recipient, together', async () => {
    const { prisma, service } = build();

    await service.send(draft(), 'adm_1');

    assert.equal(prisma.announcements.length, 1);
    assert.equal(prisma.outboxEvents.length, 3, 'one request per student in the cohort');
  });

  /** The failure this prevents: a mistargeted broadcast becoming an invoice instead of an error. */
  it('refuses a cohort larger than one send may reach', async () => {
    const { prisma, service } = build(11);

    const error = await service.send(draft(), 'adm_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.equal(prisma.announcements.length, 0, 'and nothing was written');
  });

  it('refuses a cohort of nobody rather than recording an empty send', async () => {
    const { service } = build(0);

    await assert.rejects(service.send(draft(), 'adm_1'), /reaches nobody/);
  });

  /** What the admin chose to spend on IS the fallback chain for every message in the send. */
  it('carries the chosen channels onto every request', async () => {
    const { prisma, service } = build(2);

    await service.send(draft(['WHATSAPP', 'SMS']), 'adm_1');

    for (const event of prisma.outboxEvents) {
      const payload = event.payload as { escalate?: string[]; announcementId?: string };
      assert.deepEqual(payload.escalate, ['WHATSAPP', 'SMS']);
      assert.equal(payload.announcementId, prisma.announcements[0]?.id);
    }
  });
});

describe('Sending the same notice again', () => {
  /** "Send again" rebuilds nothing: it reads back the filter the first send recorded. */
  it('reads the audience back off a sent announcement', async () => {
    const { service } = build();

    const sent = await service.send(draft(), 'adm_1');
    const page = await service.list({ page: 1, pageSize: 20 });

    assert.deepEqual(sent.audience, AUDIENCE);
    assert.deepEqual(
      page.items[0]?.audience,
      AUDIENCE,
      'and the list carries it, not just the detail',
    );
  });

  /** Each send is its own row, so the history stays honest about who was told what, and when. */
  it('records a second row rather than editing the first', async () => {
    const { service, prisma } = build();

    await service.send(draft(), 'adm_1');
    await service.send(draft(), 'adm_1');

    assert.equal(prisma.announcements.length, 2);
  });
});
