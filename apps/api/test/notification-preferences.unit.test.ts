import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DeliveryChannel } from '@prisma/client';
import { AppException, ErrorCodes, NOTIFICATION_TYPE } from '@iace/contracts';
import { NotificationPreferencesService } from '../src/notifications/notification-preferences.service';
import { FakeConfig, FakeNotificationsPrisma } from './support/fakes';

/** An absent row is the channel's default, so this is about what a student CHANGED, not what is. */

const STUDENT = 'stu_1';
const MOBILES = { [STUDENT]: '9876543210' };
const VAPID = {
  VAPID_PUBLIC_KEY: 'BPublicKey',
  VAPID_PRIVATE_KEY: 'private',
  VAPID_SUBJECT: 'mailto:a@b.c',
};

function build(env: Record<string, unknown> = VAPID, emails: Record<string, string> = {}) {
  const prisma = new FakeNotificationsPrisma([], MOBILES, emails);
  const service = new NotificationPreferencesService(
    prisma.asService(),
    new FakeConfig(env).asService(),
  );
  return { prisma, service };
}

const channelOf = (
  set: { channels: { channel: string; enabled: boolean; locked: boolean; available: boolean }[] },
  channel: string,
) => set.channels.find((row) => row.channel === channel);

describe('What a student who has said nothing gets', () => {
  /** The realigned policy, read back from the screen's own end: free leads, paid is opted into. */
  it('has the free channels on and every paid one off', async () => {
    const { service } = build();

    const set = await service.read(STUDENT);

    assert.equal(channelOf(set, DeliveryChannel.IN_APP)?.enabled, true);
    assert.equal(channelOf(set, DeliveryChannel.WEB_PUSH)?.enabled, true);
    assert.equal(channelOf(set, DeliveryChannel.WHATSAPP)?.enabled, false);
    assert.equal(channelOf(set, DeliveryChannel.SMS)?.enabled, false);
    assert.equal(channelOf(set, DeliveryChannel.EMAIL)?.enabled, false);
  });

  it('answers the delivery path from the same defaults', async () => {
    const { service } = build();

    const push = await service.allows(STUDENT, DeliveryChannel.WEB_PUSH, NOTIFICATION_TYPE.GENERIC);
    const paid = await service.allows(STUDENT, DeliveryChannel.SMS, NOTIFICATION_TYPE.GENERIC);

    assert.equal(push, true);
    assert.equal(paid, false);
  });

  /** Unavailable and switched off are different facts: one is the platform's, one is the student's. */
  it('marks a channel with nothing behind it unavailable, not off', async () => {
    const { service } = build({});

    const set = await service.read(STUDENT);

    assert.equal(channelOf(set, DeliveryChannel.WEB_PUSH)?.available, false);
    assert.equal(channelOf(set, DeliveryChannel.WEB_PUSH)?.enabled, true);
    assert.equal(channelOf(set, DeliveryChannel.EMAIL)?.available, false, 'no address on file');
    assert.equal(set.webPushPublicKey, null);
  });

  it('offers email once an address is on file', async () => {
    const { service } = build(VAPID, { [STUDENT]: 'student@example.com' });

    const set = await service.read(STUDENT);

    assert.equal(channelOf(set, DeliveryChannel.EMAIL)?.available, true);
  });
});

describe('The bell is the floor', () => {
  /** Ignoring the write would leave the switch lying about what the platform will do. */
  it('refuses to turn in-app off rather than quietly dropping it', async () => {
    const { service, prisma } = build();

    const error = await service
      .set(STUDENT, { channel: DeliveryChannel.IN_APP, enabled: false })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.equal(prisma.preferences.length, 0);
  });

  it('says in-app is on and cannot be changed', async () => {
    const { service } = build();

    const set = await service.read(STUDENT);

    assert.equal(channelOf(set, DeliveryChannel.IN_APP)?.locked, true);
  });

  it('allows in-app whatever the table holds', async () => {
    const { service, prisma } = build();
    prisma.preferences.push({
      id: 'pref_x',
      studentId: STUDENT,
      channel: DeliveryChannel.IN_APP,
      type: null,
      enabled: false,
      updatedAt: new Date(),
    });

    assert.equal(
      await service.allows(STUDENT, DeliveryChannel.IN_APP, NOTIFICATION_TYPE.RESULT_READY),
      true,
    );
  });
});

describe('Changing a channel', () => {
  it('turns a free channel off and the delivery path follows', async () => {
    const { service } = build();

    const set = await service.set(STUDENT, {
      channel: DeliveryChannel.WEB_PUSH,
      enabled: false,
    });

    assert.equal(channelOf(set, DeliveryChannel.WEB_PUSH)?.enabled, false);
    assert.equal(
      await service.allows(STUDENT, DeliveryChannel.WEB_PUSH, NOTIFICATION_TYPE.RESULT_READY),
      false,
    );
  });

  /** Postgres holds NULLs distinct, so writing twice must replace rather than pile up a second row. */
  it('leaves one row however often it is toggled', async () => {
    const { service, prisma } = build();

    await service.set(STUDENT, { channel: DeliveryChannel.WHATSAPP, enabled: true });
    await service.set(STUDENT, { channel: DeliveryChannel.WHATSAPP, enabled: false });
    await service.set(STUDENT, { channel: DeliveryChannel.WHATSAPP, enabled: true });

    assert.equal(prisma.preferences.length, 1);
    assert.equal(prisma.preferences[0]?.enabled, true);
  });

  /** One student's switch is their own: a second student's row must not answer for them. */
  it('keeps one student’s choice out of another’s', async () => {
    const { service } = build();

    await service.set(STUDENT, { channel: DeliveryChannel.WEB_PUSH, enabled: false });

    assert.equal(
      await service.allows('stu_2', DeliveryChannel.WEB_PUSH, NOTIFICATION_TYPE.GENERIC),
      true,
    );
  });
});

describe('A choice made about one kind', () => {
  /** The model carries per-type rows even though the screen writes the broad one. */
  it('wins over the one covering every kind', async () => {
    const { service, prisma } = build();
    prisma.preferences.push(
      {
        id: 'pref_all',
        studentId: STUDENT,
        channel: DeliveryChannel.WEB_PUSH,
        type: null,
        enabled: false,
        updatedAt: new Date('2026-01-01'),
      },
      {
        id: 'pref_one',
        studentId: STUDENT,
        channel: DeliveryChannel.WEB_PUSH,
        type: NOTIFICATION_TYPE.RESULT_READY,
        enabled: true,
        updatedAt: new Date('2026-01-02'),
      },
    );

    const result = await service.allows(
      STUDENT,
      DeliveryChannel.WEB_PUSH,
      NOTIFICATION_TYPE.RESULT_READY,
    );
    const other = await service.allows(
      STUDENT,
      DeliveryChannel.WEB_PUSH,
      NOTIFICATION_TYPE.GENERIC,
    );

    assert.equal(result, true, 'the kind’s own row decides for that kind');
    assert.equal(other, false, 'and the broad row still decides for the rest');
  });
});
