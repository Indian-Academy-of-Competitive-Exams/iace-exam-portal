import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import { NOTIFICATION_TYPE } from '@iace/contracts';
import { NotificationListener } from '../src/notifications/notification.listener';
import { NotificationsService } from '../src/notifications/notifications.service';
import { makeStudent, resetDatabase, testPrisma } from './support/database';

/** A REACTION to a committed fact, so it may never throw back at what caused it. */

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

  /** The account already exists by the time this runs, so a failure must not read as a failed signup. */
  it('never throws its failure back at the signup that caused it', async () => {
    const broken = {
      tell: () => Promise.reject(new Error('postgres is down')),
    } as unknown as NotificationsService;
    const failing = new NotificationListener(prisma, broken);

    await assert.doesNotReject(failing.onSignedUp({ studentId: randomUUID() }));
  });
});
