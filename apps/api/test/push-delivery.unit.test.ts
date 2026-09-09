import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DeliveryChannel, DeliveryStatus } from '@prisma/client';
import { NOTIFICATION_INBOX_PATH, NOTIFICATION_TYPE } from '@iace/contracts';
import { NotificationPreferencesService } from '../src/notifications/notification-preferences.service';
import { PushService } from '../src/notifications/push.service';
import { FakeConfig, FakeNotificationsPrisma, FakePushSender } from './support/fakes';

/** A free channel, sent where it is booked. The bell is already written, so nothing here may throw. */

const STUDENT = 'stu_1';
const VAPID = {
  VAPID_PUBLIC_KEY: 'BPublicKey',
  VAPID_PRIVATE_KEY: 'private',
  VAPID_SUBJECT: 'mailto:a@b.c',
};

const NOTIFICATION = {
  notificationId: 'ntf_1',
  studentId: STUDENT,
  type: NOTIFICATION_TYPE.RESULT_READY,
  title: 'Your result is ready',
};

const SUBSCRIPTION = {
  endpoint: 'https://push.example/one',
  p256dh: 'key-one',
  auth: 'auth-one',
};

function build(sender = new FakePushSender()) {
  const prisma = new FakeNotificationsPrisma([], { [STUDENT]: '9876543210' });
  const preferences = new NotificationPreferencesService(
    prisma.asService(),
    new FakeConfig(VAPID).asService(),
  );
  return {
    prisma,
    preferences,
    sender,
    push: new PushService(prisma.asService(), preferences, sender),
  };
}

describe('Subscribing this browser', () => {
  it('holds one row per endpoint, however often the same device asks', async () => {
    const { push, prisma } = build();

    await push.subscribe(STUDENT, SUBSCRIPTION);
    await push.subscribe(STUDENT, { ...SUBSCRIPTION, p256dh: 'rotated' });

    assert.equal(prisma.subscriptions.length, 1);
    assert.equal(prisma.subscriptions[0]?.p256dh, 'rotated');
  });

  /** Scoped by student, so somebody else's endpoint in the body deletes nothing of theirs. */
  it('drops only an endpoint the student asking owns', async () => {
    const { push, prisma } = build();
    await push.subscribe(STUDENT, SUBSCRIPTION);

    await push.unsubscribe('stu_2', SUBSCRIPTION.endpoint);

    assert.equal(prisma.subscriptions.length, 1);

    await push.unsubscribe(STUDENT, SUBSCRIPTION.endpoint);

    assert.equal(prisma.subscriptions.length, 0);
  });
});

describe('Sending a notification as a push', () => {
  it('reaches every browser the student has subscribed', async () => {
    const { push, sender } = build();
    await push.subscribe(STUDENT, SUBSCRIPTION);
    await push.subscribe(STUDENT, { ...SUBSCRIPTION, endpoint: 'https://push.example/two' });

    await push.deliver(NOTIFICATION);

    assert.deepEqual(
      sender.sent.map((row) => row.endpoint),
      ['https://push.example/one', 'https://push.example/two'],
    );
  });

  /** The whole payload rule: a locked phone renders this, so it must carry no score and no answer. */
  it('carries a title and a link into the app, and nothing else', async () => {
    const { push, sender } = build();
    await push.subscribe(STUDENT, SUBSCRIPTION);

    await push.deliver(NOTIFICATION);

    assert.deepEqual(sender.sent[0]?.payload, {
      title: 'Your result is ready',
      url: NOTIFICATION_INBOX_PATH,
      notificationId: 'ntf_1',
    });
  });

  it('records the send on the delivery ledger', async () => {
    const { push, prisma } = build();
    await push.subscribe(STUDENT, SUBSCRIPTION);

    await push.deliver(NOTIFICATION);

    assert.equal(prisma.deliveries[0]?.channel, DeliveryChannel.WEB_PUSH);
    assert.equal(prisma.deliveries[0]?.status, DeliveryStatus.SENT);
  });

  /** The ledger row IS the decision, so a redelivered job must not push the same thing again. */
  it('pushes once however many times the job runs', async () => {
    const { push, sender } = build();
    await push.subscribe(STUDENT, SUBSCRIPTION);

    await push.deliver(NOTIFICATION);
    await push.deliver(NOTIFICATION);

    assert.equal(sender.sent.length, 1);
  });

  /** An absence, not a decision: recording one row per student who never enabled push is noise. */
  it('records nothing for a student with no subscription at all', async () => {
    const { push, prisma } = build();

    await push.deliver(NOTIFICATION);

    assert.equal(prisma.deliveries.length, 0);
  });

  it('sends nothing at all when no VAPID keypair is configured', async () => {
    const { push, sender, prisma } = build(new FakePushSender(false));
    await push.subscribe(STUDENT, SUBSCRIPTION);

    await push.deliver(NOTIFICATION);

    assert.equal(sender.sent.length, 0);
    assert.equal(prisma.deliveries.length, 0);
  });
});

describe('When a student has turned push off', () => {
  it('sends nothing and records why', async () => {
    const { push, sender, preferences, prisma } = build();
    await push.subscribe(STUDENT, SUBSCRIPTION);
    await preferences.set(STUDENT, { channel: DeliveryChannel.WEB_PUSH, enabled: false });

    await push.deliver(NOTIFICATION);

    assert.equal(sender.sent.length, 0);
    assert.equal(prisma.deliveries[0]?.status, DeliveryStatus.SKIPPED);
    assert.equal(prisma.deliveries[0]?.skipReason, 'OPTED_OUT');
  });
});

describe('When an endpoint has gone', () => {
  /** A push service reporting 410 is telling us the subscription is dead, so we stop holding it. */
  it('prunes the dead subscription and keeps the live one', async () => {
    const dead = 'https://push.example/dead';
    const { push, prisma } = build(new FakePushSender(true, [dead]));
    await push.subscribe(STUDENT, SUBSCRIPTION);
    await push.subscribe(STUDENT, { ...SUBSCRIPTION, endpoint: dead });

    await push.deliver(NOTIFICATION);

    assert.deepEqual(
      prisma.subscriptions.map((row) => row.endpoint),
      [SUBSCRIPTION.endpoint],
    );
    assert.equal(prisma.deliveries[0]?.status, DeliveryStatus.SENT, 'the live one still got it');
  });

  it('records a failure when nothing accepted it', async () => {
    const { push, prisma } = build(new FakePushSender(true, [], [SUBSCRIPTION.endpoint]));
    await push.subscribe(STUDENT, SUBSCRIPTION);

    await push.deliver(NOTIFICATION);

    assert.equal(prisma.deliveries[0]?.status, DeliveryStatus.FAILED);
  });

  /** The bell is the source of truth: a push service being down cannot fail the job that wrote it. */
  it('never throws its failure back at the caller', async () => {
    const { push } = build({
      isConfigured: true,
      send: () => Promise.reject(new Error('push service is down')),
    } as never);
    await push.subscribe(STUDENT, SUBSCRIPTION);

    await assert.doesNotReject(push.deliver(NOTIFICATION));
  });
});
