import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { DeliveryChannel, DeliveryStatus } from '@prisma/client';
import { NOTIFICATION_INBOX_PATH, NOTIFICATION_TYPE } from '@iace/contracts';
import { PushService } from '../src/notifications/push.service';
import { FakeConfig, FakePushSender } from '../test/support/fakes';
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

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** A student with one unread result in the bell, and the push service over them. */
async function build(sender = new FakePushSender()) {
  const student = await makeStudent(prisma);
  const notification = await makeNotification(prisma, {
    studentId: student.id,
    title: 'Your result is ready',
  });
  return {
    student: student.id,
    sender,
    push: new PushService(prisma, new FakeConfig(VAPID).asService(), sender as never),
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
