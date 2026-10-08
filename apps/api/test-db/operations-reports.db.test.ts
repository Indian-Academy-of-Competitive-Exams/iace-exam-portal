import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AppException,
  AUDIT_ACTION,
  ErrorCodes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  REPORT_KEYS,
  TEST_SERIES_KIND,
  TEST_STATUS,
} from '@iace/contracts';
import {
  makeAdmin,
  makeAnnouncement,
  makeBranch,
  makeCatalog,
  makeSitting,
  makeStudent,
  makeTest,
  resetDatabase,
  rowActions,
  testPrisma,
} from './support/database';
import { SUPER_ADMIN, VIEWER, figureOf, reportsOver, tableOf } from './support/reports';

const prisma = testPrisma();
const { read } = reportsOver(prisma);

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const WEEK = { from: '2026-06-08', to: '2026-06-14' };
const IN_WEEK = new Date('2026-06-09T06:00:00.000Z');

const forbidden = (error: unknown) => AppException.is(error) && error.code === ErrorCodes.FORBIDDEN;

describe('the audit trail', () => {
  it('shows a super admin everybody’s changes and refuses anybody else, as the log screen does', async () => {
    const other = await makeAdmin(prisma, { fullName: 'Somebody Else' });
    await rowActions(prisma, [
      { actorId: VIEWER.id, createdAt: IN_WEEK },
      { actorId: other.id, createdAt: IN_WEEK },
      { actorId: VIEWER.id, createdAt: new Date('2026-05-01T06:00:00.000Z') },
    ]);

    const all = await read(REPORT_KEYS.AUDIT_TRAIL, WEEK, SUPER_ADMIN);

    await assert.rejects(read(REPORT_KEYS.AUDIT_TRAIL, WEEK), forbidden);
    assert.equal(figureOf(all, 'Changes'), 2);
    assert.deepEqual(
      tableOf(all, 'Audit log')
        .map((row) => row.Actor)
        .sort(),
      ['Somebody Else', null],
    );
  });
});

describe('the admin activity', () => {
  it('counts what each admin did by action', async () => {
    const admin = await makeAdmin(prisma, { fullName: 'Front Desk' });
    await rowActions(prisma, [
      { actorId: admin.id, action: AUDIT_ACTION.CREATE, createdAt: IN_WEEK },
      { actorId: admin.id, action: AUDIT_ACTION.UPDATE, createdAt: IN_WEEK },
      { actorId: admin.id, action: AUDIT_ACTION.UPDATE, createdAt: IN_WEEK },
    ]);

    const rows = tableOf(
      await read(REPORT_KEYS.ADMIN_ACTIVITY, WEEK, SUPER_ADMIN),
      'Admin activity',
    );

    assert.deepEqual(
      rows.map((row) => [row.Admin, row.Created, row.Updated, row.Total]),
      [['Front Desk', 1, 2, 3]],
    );
  });

  it('is refused to an admin who is not a super admin', async () => {
    await assert.rejects(read(REPORT_KEYS.ADMIN_ACTIVITY, WEEK), forbidden);
  });
});

describe('the admins and permissions', () => {
  it('reads a super admin as holding everything, and anyone else by their grants', async () => {
    await makeAdmin(prisma, { fullName: 'Owner', isSuperAdmin: true });
    const desk = await makeAdmin(prisma, { fullName: 'Front Desk' });
    await prisma.adminFeaturePermission.create({
      data: {
        adminId: desk.id,
        featureKey: FEATURE_KEYS.REPORTS,
        level: PERMISSION_LEVELS.READ,
      },
    });

    const rows = tableOf(
      await read(REPORT_KEYS.PERMISSIONS_MATRIX, {}, SUPER_ADMIN),
      'Permissions',
    );

    assert.deepEqual(
      rows.map((row) => [row.Admin, row.Reports, row.Students]),
      [
        ['Front Desk', 'Read', null],
        ['Owner', 'All', 'All'],
      ],
    );
  });

  it('is refused to an admin who is not a super admin', async () => {
    await assert.rejects(read(REPORT_KEYS.PERMISSIONS_MATRIX, {}), forbidden);
  });
});

describe('the announcements and their cost', () => {
  it('sums what the period’s announcements were priced at when they were sent', async () => {
    const priced = (paise: number, createdAt: Date) =>
      makeAnnouncement(prisma, ['SMS']).then(({ id }) =>
        prisma.announcement.update({
          where: { id },
          data: { estimatedCostPaise: paise, recipientCount: 40, createdAt },
        }),
      );
    await priced(1250, IN_WEEK);
    await priced(750, IN_WEEK);
    await priced(9999, new Date('2026-05-01T06:00:00.000Z'));

    const document = await read(REPORT_KEYS.ANNOUNCEMENTS, WEEK);

    assert.equal(figureOf(document, 'Announcements'), 2);
    assert.equal(figureOf(document, 'Recipients'), 80);
    assert.equal(figureOf(document, 'Estimated cost (rupees)'), 20);
  });
});

describe('the weekly institute report', () => {
  it('sets the period’s tests, branches and toppers under the institute’s own counts', async () => {
    const catalog = await makeCatalog(prisma);
    await prisma.testSeries.update({
      where: { id: catalog.testSeriesId },
      data: { kind: TEST_SERIES_KIND.FREE },
    });
    const test = await makeTest(prisma, catalog, {
      title: 'Mock 1',
      status: TEST_STATUS.ACTIVE,
      finalizedAt: new Date(),
    });
    const north = (await makeBranch(prisma, 'NORTH')).id;
    const ana = await makeStudent(prisma, { fullName: 'Ana', currentBranchId: north });
    await makeStudent(prisma, { fullName: 'Bala', currentBranchId: north });
    await makeSitting(prisma, {
      testId: test.id,
      studentId: ana.id,
      score: 40,
      submittedAt: IN_WEEK,
    });

    const document = await read(REPORT_KEYS.DIGEST_WEEKLY, WEEK);

    assert.equal(figureOf(document, 'Students enrolled'), 2);
    assert.equal(figureOf(document, 'Participation (%)'), 50);
    assert.deepEqual(
      document.tables.map((table) => table.title),
      ['Tests', 'Branch performance', 'Top performers'],
    );
    assert.deepEqual(
      tableOf(document, 'Top performers').map((row) => row.Student),
      ['Ana'],
    );
  });
});
