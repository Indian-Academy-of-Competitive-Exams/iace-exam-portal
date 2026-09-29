import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import { NOTIFICATION_TYPE } from '@iace/contracts';
import { PIN_RESET_REASONS } from '../src/common/events';
import { NotificationListener } from '../src/notifications/notification.listener';
import { NotificationsService } from '../src/notifications/notifications.service';
import { makeStudent, resetDatabase, testPrisma } from './support/database';

/** Both are REACTIONS to a committed fact, so neither may ever throw back at what caused it. */

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const listener = new NotificationListener(prisma, new NotificationsService(prisma));

const written = () => prisma.notification.findMany({ orderBy: { createdAt: 'asc' } });

const aStudent = async () => (await makeStudent(prisma)).id;

describe('Signing up', () => {
  it('writes a welcome the student reads in the bell', async () => {
    const student = await aStudent();
    await listener.onSignedUp({ studentId: student });

    const [row] = await written();
    assert.ok(row);
    assert.equal(row.type, NOTIFICATION_TYPE.WELCOME);
    assert.equal(row.studentId, student);
    assert.equal(row.dedupeKey, `welcome:${student}`);
  });
});

describe('A PIN changing', () => {
  /** Told either way on purpose: a student cannot spot the one they did not do without both. */
  it('tells them however the change was made', async () => {
    await listener.onPinReset({
      studentId: await aStudent(),
      mobile: '9876543210',
      reason: PIN_RESET_REASONS.SELF_CHANGE,
    });
    await listener.onPinReset({
      studentId: await aStudent(),
      mobile: '9876543211',
      reason: PIN_RESET_REASONS.OTP_RESET,
    });

    const rows = await written();
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.type === NOTIFICATION_TYPE.PIN_CHANGED));
  });

  /** A forgotten PIN was reset by somebody holding the mobile, which is the fact worth naming. */
  it('says which of the two paths it was', async () => {
    await listener.onPinReset({
      studentId: await aStudent(),
      mobile: '9876543210',
      reason: PIN_RESET_REASONS.OTP_RESET,
    });

    assert.match(String((await written())[0]?.body), /code sent to your mobile/);
  });

  /** The PIN is already changed by the time this runs, so a failure must not read as a failed one. */
  it('never throws its failure back at the change that caused it', async () => {
    const broken = {
      tell: () => Promise.reject(new Error('postgres is down')),
    } as unknown as NotificationsService;
    const failing = new NotificationListener(prisma, broken);

    await assert.doesNotReject(
      failing.onPinReset({
        studentId: randomUUID(),
        mobile: '9876543210',
        reason: PIN_RESET_REASONS.SELF_CHANGE,
      }),
    );
    await assert.doesNotReject(failing.onSignedUp({ studentId: randomUUID() }));
  });
});
