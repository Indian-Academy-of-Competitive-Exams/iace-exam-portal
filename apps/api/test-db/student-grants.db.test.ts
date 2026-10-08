import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { AppException, ErrorCodes } from '@iace/contracts';
import { AccessResolverService } from '../src/access/access-resolver.service';
import { StudentGrantsService } from '../src/access/student-grants.service';
import { AuditContext, AuditService } from '../src/audit';
import { NotificationsService } from '../src/notifications/notifications.service';
import { FakeRedis, FakeStorage } from '../test/support/fakes';
import { makeCatalog, makeStudent, resetDatabase, testPrisma, uid } from './support/database';

const ADMIN = uid();

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** The grants service over one series, with the audit context a route would run it in. */
async function build() {
  const { testSeriesId } = await makeCatalog(prisma);
  const auditContext = new AuditContext();
  const grants = new StudentGrantsService(
    prisma,
    auditContext,
    new NotificationsService(prisma),
    new AuditService(prisma, new FakeStorage() as never),
    new AccessResolverService(prisma, new FakeRedis().asService()),
  );
  return { grants, auditContext, series: { testSeriesId } };
}

const toldTo = (studentId: string) => prisma.notification.count({ where: { studentId } });

describe('StudentGrantsService — a grant made again is told again', () => {
  /** The failure this prevents: a key naming the series, so the second grant was swallowed as a replay of the first. */
  it('tells the student again after a revoke, and once however often the same grant is re-sent', async () => {
    const { grants, series } = await build();
    const student = await makeStudent(prisma);

    await grants.grant(student.id, series, ADMIN);
    await grants.grant(student.id, series, ADMIN);
    assert.equal(await toldTo(student.id), 1, 're-sent');

    await grants.revoke(student.id, series.testSeriesId);
    await grants.grant(student.id, series, ADMIN);
    assert.equal(await toldTo(student.id), 2, 'granted again after a revoke');
  });

  /** The failure this prevents: the second of two grants landing together dying on the key the first had just taken. */
  it('makes one grant and tells once when the same grant lands twice at the same instant', async () => {
    const { grants, series } = await build();
    const student = await makeStudent(prisma);

    await Promise.all([
      grants.grant(student.id, series, ADMIN),
      grants.grant(student.id, series, ADMIN),
    ]);

    assert.equal(await prisma.studentGrant.count(), 1);
    assert.equal(await toldTo(student.id), 1);
  });
});

describe('StudentGrantsService — what a grant leaves in the audit log', () => {
  /** A grant has no row of its own in the log, so the entry on the student has to say which series. */
  it('names the series for a grant and for a revoke, and nothing for one that changed nothing', async () => {
    const { grants, auditContext, series } = await build();
    await prisma.testSeries.update({
      where: { id: series.testSeriesId },
      data: { name: 'RRB JE mocks' },
    });
    const student = await makeStudent(prisma);
    const logged = (write: () => Promise<void>) =>
      auditContext.run(async () => {
        await write();
        return auditContext.current();
      });

    const granted = await logged(() => grants.grant(student.id, series, ADMIN));
    const again = await logged(() => grants.grant(student.id, series, ADMIN));
    const revoked = await logged(() => grants.revoke(student.id, series.testSeriesId));

    assert.equal(granted?.entityId, student.id);
    assert.deepEqual(granted?.changed, { series: { from: null, to: 'RRB JE mocks' } });
    assert.equal(again?.changed, null);
    assert.deepEqual(revoked?.changed, { series: { from: 'RRB JE mocks', to: null } });
  });
});

describe('StudentGrantsService — an erased student', () => {
  /** A tombstone is granted nothing and told nothing. */
  it('is refused a grant, and a revoke', async () => {
    const { grants, series } = await build();
    const erased = await makeStudent(prisma, { deletedAt: new Date(), anonymizedAt: new Date() });
    const notFound = (error: unknown) =>
      AppException.is(error) && error.code === ErrorCodes.NOT_FOUND;

    await assert.rejects(() => grants.grant(erased.id, series, ADMIN), notFound);
    await assert.rejects(() => grants.revoke(erased.id, series.testSeriesId), notFound);

    assert.equal(await prisma.studentGrant.count(), 0);
    assert.equal(await prisma.notification.count(), 0);
  });
});
