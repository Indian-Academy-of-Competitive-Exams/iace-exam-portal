import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NOTIFICATION_TYPE } from '@iace/contracts';
import { PIN_RESET_REASONS } from '../src/common/events';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { NotificationListener } from '../src/notifications/notification.listener';
import { FakeNotificationsPrisma, FakeQueue } from './support/fakes';

/** Both are REACTIONS to a committed fact, so neither may ever throw back at what caused it. */

const STUDENT = 'stu_1';

function build() {
  const prisma = new FakeNotificationsPrisma();
  const outbox = new NotificationOutbox(prisma.asService(), new FakeQueue().asQueue());
  return { prisma, listener: new NotificationListener(prisma.asService(), outbox) };
}

const written = (prisma: FakeNotificationsPrisma) =>
  prisma.outboxEvents.map((row) => row.payload as Record<string, unknown>);

describe('Signing up', () => {
  it('writes a welcome the student reads in the bell', async () => {
    const { prisma, listener } = build();

    await listener.onSignedUp({ studentId: STUDENT });

    const [intent] = written(prisma);
    assert.equal(intent?.type, NOTIFICATION_TYPE.WELCOME);
    assert.equal(intent?.studentId, STUDENT);
    assert.equal(intent?.dedupeKey, `welcome:${STUDENT}`);
  });
});

describe('A PIN changing', () => {
  /** Told either way on purpose: a student cannot spot the one they did not do without both. */
  it('tells them however the change was made', async () => {
    const { prisma, listener } = build();

    await listener.onPinReset({
      studentId: STUDENT,
      mobile: '9876543210',
      reason: PIN_RESET_REASONS.SELF_CHANGE,
    });
    await listener.onPinReset({
      studentId: 'stu_2',
      mobile: '9876543211',
      reason: PIN_RESET_REASONS.OTP_RESET,
    });

    const intents = written(prisma);
    assert.equal(intents.length, 2);
    assert.ok(intents.every((intent) => intent.type === NOTIFICATION_TYPE.PIN_CHANGED));
  });

  /** A forgotten PIN was reset by somebody holding the mobile, which is the fact worth naming. */
  it('says which of the two paths it was', async () => {
    const { prisma, listener } = build();

    await listener.onPinReset({
      studentId: STUDENT,
      mobile: '9876543210',
      reason: PIN_RESET_REASONS.OTP_RESET,
    });

    assert.match(String(written(prisma)[0]?.body), /code sent to your mobile/);
  });

  /** The PIN is already changed by the time this runs, so a failure must not read as a failed one. */
  it('never throws its failure back at the change that caused it', async () => {
    const prisma = new FakeNotificationsPrisma();
    const broken = {
      request: () => Promise.reject(new Error('outbox is down')),
    } as unknown as NotificationOutbox;
    const listener = new NotificationListener(prisma.asService(), broken);

    await assert.doesNotReject(
      listener.onPinReset({
        studentId: STUDENT,
        mobile: '9876543210',
        reason: PIN_RESET_REASONS.SELF_CHANGE,
      }),
    );
    await assert.doesNotReject(listener.onSignedUp({ studentId: STUDENT }));
  });
});
