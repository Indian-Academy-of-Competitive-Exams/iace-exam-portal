import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { DeliveryChannel, DeliveryStatus, DevicePlatform } from '@prisma/client';
import { NOTIFICATION_INBOX_PATH, NOTIFICATION_TYPE } from '@iace/contracts';
import { PushService } from '../src/notifications/push.service';
import { FakeConfig, FakeFcmSender, FakePushSender } from '../test/support/fakes';
import { makeNotification, makeStudent, resetDatabase, testPrisma, uid } from './support/database';

/** A free channel, sent where it is booked. The bell is already written, so nothing here may throw. */

const VAPID = {
  VAPID_PUBLIC_KEY: 'BPublicKey',
  VAPID_PRIVATE_KEY: 'private',
  VAPID_SUBJECT: 'mailto:a@b.c',
};

const SUBSCRIPTION = {
  endpoint: 'https://push.example/one',
  p256dh: 'key-one',
  auth: 'auth-one',
};

const DEVICE = { token: 'fcm-one', platform: DevicePlatform.ANDROID, deviceName: 'Pixel 7a' };

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** A student with one unread result in the bell, and the push service over them. */
async function build(sender = new FakePushSender(), fcm = new FakeFcmSender()) {
  const student = await makeStudent(prisma);
  const notification = await makeNotification(prisma, {
    studentId: student.id,
    title: 'Your result is ready',
  });
  return {
    student: student.id,
    sender,
    fcm,
    push: new PushService(prisma, new FakeConfig(VAPID).asService(), sender as never, fcm as never),
    delivery: {
      notificationId: notification.id,
      studentId: student.id,
      type: NOTIFICATION_TYPE.RESULT_READY,
      title: 'Your result is ready',
    },
  };
}

const endpoints = async () =>
  (await prisma.pushSubscription.findMany()).map((row) => row.endpoint).sort();

describe('Subscribing this browser', () => {
  it('holds one row per endpoint, however often the same device asks', async () => {
    const { push, student } = await build();

    await push.subscribe(student, SUBSCRIPTION);
    await push.subscribe(student, { ...SUBSCRIPTION, p256dh: 'rotated' });

    const rows = await prisma.pushSubscription.findMany();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.p256dh, 'rotated');
  });

  /** Scoped by student, so somebody else's endpoint in the body deletes nothing of theirs. */
  it('drops only an endpoint the student asking owns', async () => {
    const { push, student } = await build();
    await push.subscribe(student, SUBSCRIPTION);

    await push.unsubscribe(uid(), SUBSCRIPTION.endpoint);

    assert.equal(await prisma.pushSubscription.count(), 1);

    await push.unsubscribe(student, SUBSCRIPTION.endpoint);

    assert.equal(await prisma.pushSubscription.count(), 0);
  });
});

describe('Sending a notification as a push', () => {
  it('reaches every browser the student has subscribed', async () => {
    const { push, sender, student, delivery } = await build();
    await push.subscribe(student, SUBSCRIPTION);
    await push.subscribe(student, { ...SUBSCRIPTION, endpoint: 'https://push.example/two' });

    await push.deliver(delivery);

    assert.deepEqual(sender.sent.map((row) => row.endpoint).sort(), [
      'https://push.example/one',
      'https://push.example/two',
    ]);
  });

  /** The whole payload rule: a locked phone renders this, so it must carry no score and no answer. */
  it('carries a title and a link into the app, and nothing else', async () => {
    const { push, sender, student, delivery } = await build();
    await push.subscribe(student, SUBSCRIPTION);

    await push.deliver(delivery);

    assert.deepEqual(sender.sent[0]?.payload, {
      title: 'Your result is ready',
      url: NOTIFICATION_INBOX_PATH,
      notificationId: delivery.notificationId,
    });
  });

  it('records the send on the delivery ledger', async () => {
    const { push, student, delivery } = await build();
    await push.subscribe(student, SUBSCRIPTION);

    await push.deliver(delivery);

    const [row] = await prisma.notificationDelivery.findMany();
    assert.equal(row?.channel, DeliveryChannel.WEB_PUSH);
    assert.equal(row?.status, DeliveryStatus.SENT);
  });

  /** The ledger row IS the decision, so a redelivered job must not push the same thing again. */
  it('pushes once however many times the job runs', async () => {
    const { push, sender, student, delivery } = await build();
    await push.subscribe(student, SUBSCRIPTION);

    await push.deliver(delivery);
    await push.deliver(delivery);

    assert.equal(sender.sent.length, 1);
  });

  /** An absence, not a decision: recording one row per student who never enabled push is noise. */
  it('records nothing for a student with no subscription at all', async () => {
    const { push, delivery } = await build();

    await push.deliver(delivery);

    assert.equal(await prisma.notificationDelivery.count(), 0);
  });

  it('sends nothing at all when no VAPID keypair is configured', async () => {
    const { push, sender, student, delivery } = await build(new FakePushSender(false));
    await push.subscribe(student, SUBSCRIPTION);

    await push.deliver(delivery);

    assert.equal(sender.sent.length, 0);
    assert.equal(await prisma.notificationDelivery.count(), 0);
  });
});

describe('When a student has turned push off in the browser', () => {
  /** Revoking permission deletes the subscription, so the absence IS the refusal and costs no row. */
  it('sends nothing and books nothing', async () => {
    const { push, sender, student, delivery } = await build();
    await push.subscribe(student, SUBSCRIPTION);
    await push.unsubscribe(student, SUBSCRIPTION.endpoint);

    await push.deliver(delivery);

    assert.equal(sender.sent.length, 0);
    assert.equal(await prisma.notificationDelivery.count(), 0);
  });
});

describe('When an endpoint has gone', () => {
  /** A push service reporting 410 is telling us the subscription is dead, so we stop holding it. */
  it('prunes the dead subscription and keeps the live one', async () => {
    const dead = 'https://push.example/dead';
    const { push, student, delivery } = await build(new FakePushSender(true, [dead]));
    await push.subscribe(student, SUBSCRIPTION);
    await push.subscribe(student, { ...SUBSCRIPTION, endpoint: dead });

    await push.deliver(delivery);

    assert.deepEqual(await endpoints(), [SUBSCRIPTION.endpoint]);
    const [row] = await prisma.notificationDelivery.findMany();
    assert.equal(row?.status, DeliveryStatus.SENT, 'the live one still got it');
  });

  it('records a failure when nothing accepted it', async () => {
    const { push, student, delivery } = await build(
      new FakePushSender(true, [], [SUBSCRIPTION.endpoint]),
    );
    await push.subscribe(student, SUBSCRIPTION);

    await push.deliver(delivery);

    const [row] = await prisma.notificationDelivery.findMany();
    assert.equal(row?.status, DeliveryStatus.FAILED);
  });

  /** The bell is the source of truth: a push service being down cannot fail the job that wrote it. */
  it('never throws its failure back at the caller', async () => {
    const { push, student, delivery } = await build({
      isConfigured: true,
      send: () => Promise.reject(new Error('push service is down')),
    } as never);
    await push.subscribe(student, SUBSCRIPTION);

    await assert.doesNotReject(push.deliver(delivery));
  });
});

describe('Registering this phone', () => {
  it('holds one row per token, however often the same phone asks', async () => {
    const { push, student } = await build();

    await push.registerDevice(student, DEVICE);
    await push.registerDevice(student, { ...DEVICE, deviceName: 'Pixel 8' });

    const rows = await prisma.pushDevice.findMany();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.deviceName, 'Pixel 8');
  });

  /** A shared phone signed into a second account must not keep pushing the first one's bell. */
  it('moves a token to whoever registered it last', async () => {
    const { push, student } = await build();
    const other = await makeStudent(prisma);
    await push.registerDevice(student, DEVICE);

    await push.registerDevice(other.id, DEVICE);

    const rows = await prisma.pushDevice.findMany();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.studentId, other.id);
  });

  /** Scoped by student, so somebody else's token in the body deletes nothing of theirs. */
  it('drops only a token the student asking owns', async () => {
    const { push, student } = await build();
    await push.registerDevice(student, DEVICE);

    await push.dropDevice(uid(), DEVICE.token);

    assert.equal(await prisma.pushDevice.count(), 1);

    await push.dropDevice(student, DEVICE.token);

    assert.equal(await prisma.pushDevice.count(), 0);
  });
});

describe('Sending a notification to a phone', () => {
  it('reaches every phone the student has registered', async () => {
    const { push, fcm, student, delivery } = await build();
    await push.registerDevice(student, DEVICE);
    await push.registerDevice(student, { ...DEVICE, token: 'fcm-two' });

    await push.deliver(delivery);

    assert.deepEqual(fcm.sent.map((row) => row.token).sort(), ['fcm-one', 'fcm-two']);
  });

  /** The same payload rule as the browser's: a locked phone renders this, so it carries no marks. */
  it('carries a title and a link into the app, and nothing else', async () => {
    const { push, fcm, student, delivery } = await build();
    await push.registerDevice(student, DEVICE);

    await push.deliver(delivery);

    assert.deepEqual(fcm.sent[0]?.payload, {
      title: 'Your result is ready',
      url: NOTIFICATION_INBOX_PATH,
      notificationId: delivery.notificationId,
    });
  });

  /** Two channels, two decisions: a phone reached is not a browser reached. */
  it('books its own ledger row beside the browser one', async () => {
    const { push, student, delivery } = await build();
    await push.subscribe(student, SUBSCRIPTION);
    await push.registerDevice(student, DEVICE);

    await push.deliver(delivery);

    const rows = await prisma.notificationDelivery.findMany();
    assert.deepEqual(rows.map((row) => row.channel).sort(), [
      DeliveryChannel.MOBILE_PUSH,
      DeliveryChannel.WEB_PUSH,
    ]);
    assert.ok(rows.every((row) => row.status === DeliveryStatus.SENT));
  });

  it('pushes once however many times the job runs', async () => {
    const { push, fcm, student, delivery } = await build();
    await push.registerDevice(student, DEVICE);

    await push.deliver(delivery);
    await push.deliver(delivery);

    assert.equal(fcm.sent.length, 1);
  });

  it('sends nothing at all when no service account is configured', async () => {
    const { push, fcm, student, delivery } = await build(
      new FakePushSender(),
      new FakeFcmSender(false),
    );
    await push.registerDevice(student, DEVICE);

    await push.deliver(delivery);

    assert.equal(fcm.sent.length, 0);
    assert.equal(await prisma.notificationDelivery.count(), 0);
  });

  /** FCM reporting a token unregistered is the phone telling us it is gone, so we stop holding it. */
  it('prunes a token FCM has retired and keeps the live one', async () => {
    const { push, student, delivery } = await build(
      new FakePushSender(),
      new FakeFcmSender(true, ['fcm-dead']),
    );
    await push.registerDevice(student, DEVICE);
    await push.registerDevice(student, { ...DEVICE, token: 'fcm-dead' });

    await push.deliver(delivery);

    const rows = await prisma.pushDevice.findMany();
    assert.deepEqual(
      rows.map((row) => row.token),
      [DEVICE.token],
    );
    const [ledger] = await prisma.notificationDelivery.findMany();
    assert.equal(ledger?.status, DeliveryStatus.SENT, 'the live one still got it');
  });

  /** The bell is the source of truth: FCM being down cannot fail the job that wrote it. */
  it('never throws its failure back at the caller', async () => {
    const { push, student, delivery } = await build(new FakePushSender(), {
      isConfigured: true,
      send: () => Promise.reject(new Error('FCM is down')),
    } as never);
    await push.registerDevice(student, DEVICE);

    await assert.doesNotReject(push.deliver(delivery));
  });
});
