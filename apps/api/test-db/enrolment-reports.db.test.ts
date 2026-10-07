import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { type Prisma } from '@prisma/client';
import {
  AppException,
  AUDIT_ACTION,
  ErrorCodes,
  REPORT_KEYS,
  STUDENT_TYPE,
  TEST_SERIES_KIND,
} from '@iace/contracts';
import { SUPPORT_ACTIONS, supportDiff } from '../src/attempts/attempt-resolution';
import {
  makeAdmin,
  makeBranch,
  makeCatalog,
  makeSitting,
  makeStudent,
  makeTest,
  resetDatabase,
  rowActions,
  testPrisma,
  uid,
  type StudentOverrides,
} from './support/database';
import { SUPER_ADMIN, figureOf, reportsOver, tableOf } from './support/reports';

const prisma = testPrisma();
const { read } = reportsOver(prisma);

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const student = async (fullName: string, over: StudentOverrides = {}) =>
  (await makeStudent(prisma, { fullName, ...over })).id;

const JUNE = { from: '2026-06-01', to: '2026-06-30' };
const IN_JUNE = new Date('2026-06-15T06:00:00.000Z');

describe('the student roster', () => {
  it('lists one branch’s students by name, and nobody who was deleted', async () => {
    const north = (await makeBranch(prisma, 'NORTH')).id;
    await student('Bala', { currentBranchId: north });
    await student('Ana', { currentBranchId: north, isTestBlocked: true });
    await student('Gone', { currentBranchId: north, deletedAt: new Date() });
    await student('Elsewhere');

    const document = await read(REPORT_KEYS.STUDENT_ROSTER, { branchId: north });

    assert.deepEqual(
      tableOf(document, 'Students').map((row) => [row.Student, row.Status]),
      [
        ['Ana', 'Tests blocked'],
        ['Bala', 'Active'],
      ],
    );
    assert.deepEqual(document.about, [{ label: 'Branch', value: 'NORTH' }]);
  });
});

describe('the new enrolments', () => {
  it('counts who joined in the period by branch, on the institute’s calendar', async () => {
    const north = (await makeBranch(prisma, 'NORTH')).id;
    // 00:30 on 1 June in Kolkata, which is still 31 May in UTC.
    const firstMinutes = new Date('2026-05-31T19:00:00.000Z');
    await student('Ana', { currentBranchId: north, createdAt: firstMinutes });
    await student('Bala', {
      currentBranchId: north,
      createdAt: IN_JUNE,
      studentType: STUDENT_TYPE.OFFLINE,
    });
    await student('July', { createdAt: new Date('2026-07-02T06:00:00.000Z') });

    const document = await read(REPORT_KEYS.NEW_ENROLMENTS, JUNE);

    assert.equal(figureOf(document, 'New students'), 2);
    assert.deepEqual(
      tableOf(document, 'By branch').map((row) => [
        row.Branch,
        row.Students,
        row.Online,
        row.Offline,
      ]),
      [['NORTH', 2, 1, 1]],
    );
  });
});

describe('the strength', () => {
  it('counts a student on two programs under each, and a suspended one apart', async () => {
    await student('Ana', { programs: ['ALPHA', 'BETA'] });
    await student('Bala', { programs: ['ALPHA'] });
    await student('Suspended', { programs: ['ALPHA'], isActive: false });

    const document = await read(REPORT_KEYS.STRENGTH, {});

    assert.equal(figureOf(document, 'Students'), 2);
    assert.equal(figureOf(document, 'Sign-in suspended'), 1);
    assert.deepEqual(
      tableOf(document, 'By program').map((row) => [row.Program, row.Students]),
      [
        ['ALPHA', 2],
        ['BETA', 1],
      ],
    );
  });
});

describe('the unfinished profiles', () => {
  const profile = (studentId: string, data: object) =>
    prisma.studentProfile.create({ data: { id: uid(), studentId, ...data } });

  it('names what each profile still lacks, and leaves out one that lacks nothing', async () => {
    const whole = await student('Whole');
    await profile(whole, {
      motherName: 'M',
      fatherName: 'F',
      dob: new Date('2001-01-01'),
      photoUrl: 'photos/x',
      gender: 'FEMALE',
    });
    const half = await student('Half');
    await profile(half, { motherName: 'M', fatherName: 'F', dob: new Date('2001-01-01') });
    await student('Blank');

    const document = await read(REPORT_KEYS.PROFILE_COMPLETENESS, {});

    assert.equal(figureOf(document, 'Not ready for a test'), 1);
    assert.deepEqual(
      tableOf(document, 'Unfinished profiles').map((row) => [
        row.Student,
        row['Ready for a test'],
        row.Missing,
      ]),
      [
        ['Blank', 'No', 'Mother’s name, Father’s name, Date of birth, Photo, Gender'],
        ['Half', 'Yes', 'Photo, Gender'],
      ],
    );
  });
});

describe('the suspended, blocked and deleted students', () => {
  it('says how each stands and who put them there, and never lists an erased student', async () => {
    const admin = await makeAdmin(prisma, { fullName: 'Branch Head' });
    const suspended = await student('Suspended', { isActive: false });
    await student('Blocked', { isTestBlocked: true });
    await student('Erased', { deletedAt: new Date(), anonymizedAt: new Date() });
    await student('Active');
    await rowActions(prisma, [
      { entityId: suspended, action: AUDIT_ACTION.DEACTIVATE, actorId: admin.id },
    ]);

    const rows = tableOf(await read(REPORT_KEYS.STUDENT_STATUS, {}, SUPER_ADMIN), 'Students');

    assert.deepEqual(
      rows.map((row) => [row.Student, row.Status, row.By]),
      [
        ['Blocked', 'Tests blocked', null],
        ['Suspended', 'Sign-in suspended', 'Branch Head'],
      ],
    );
  });

  it('names who did it only to a super admin, as the audit log itself would', async () => {
    const other = await makeAdmin(prisma, { fullName: 'Somebody Else' });
    const suspended = await student('Suspended', { isActive: false });
    await rowActions(prisma, [
      { entityId: suspended, action: AUDIT_ACTION.DEACTIVATE, actorId: other.id },
    ]);

    const [row] = tableOf(await read(REPORT_KEYS.STUDENT_STATUS, {}), 'Students');

    assert.deepEqual(
      [row?.Student, row?.Status, row?.By],
      ['Suspended', 'Sign-in suspended', null],
    );
  });

  it('reads the date and the name off the action that matches how the student stands now', async () => {
    const blocker = await makeAdmin(prisma, { fullName: 'Blocker' });
    const suspender = await makeAdmin(prisma, { fullName: 'Suspender' });
    const blocked = await student('Blocked', { isTestBlocked: true });
    await rowActions(prisma, [
      { entityId: blocked, action: AUDIT_ACTION.BLOCK, actorId: blocker.id },
      // Suspended later and let back in since: the newest row on file is not about the block.
      {
        entityId: blocked,
        action: AUDIT_ACTION.DEACTIVATE,
        actorId: suspender.id,
        createdAt: new Date(Date.now() + 60_000),
      },
    ]);

    const [row] = tableOf(await read(REPORT_KEYS.STUDENT_STATUS, {}, SUPER_ADMIN), 'Students');

    assert.deepEqual([row?.Status, row?.By], ['Tests blocked', 'Blocker']);
  });

  /** The failure this prevents: a sitting voided since, filed under the same action, read as the suspension. */
  it('reads a suspension off the suspension, not off a sitting voided for them since', async () => {
    const suspender = await makeAdmin(prisma, { fullName: 'Suspender' });
    const support = await makeAdmin(prisma, { fullName: 'Support Desk' });
    const suspended = await student('Suspended', { isActive: false });
    const voided = supportDiff(SUPPORT_ACTIONS.VOID, 'Sat the wrong paper', uid(), null);
    await rowActions(prisma, [
      {
        entityId: suspended,
        action: AUDIT_ACTION.DEACTIVATE,
        actorId: suspender.id,
        changed: { isActive: { from: true, to: false } },
      },
      {
        entityId: suspended,
        action: AUDIT_ACTION.DEACTIVATE,
        actorId: support.id,
        changed: voided as Prisma.InputJsonValue,
        createdAt: new Date(Date.now() + 60_000),
      },
    ]);

    const [row] = tableOf(await read(REPORT_KEYS.STUDENT_STATUS, {}, SUPER_ADMIN), 'Students');

    assert.deepEqual([row?.Status, row?.By], ['Sign-in suspended', 'Suspender']);
  });
});

describe('the access granted by hand', () => {
  it('lists the period’s grants with the series and who gave them', async () => {
    const catalog = await makeCatalog(prisma);
    const admin = await makeAdmin(prisma, { fullName: 'Front Desk' });
    const grant = (studentId: string, createdAt: Date) =>
      prisma.studentGrant.create({
        data: { studentId, testSeriesId: catalog.testSeriesId, createdAt, createdById: admin.id },
      });
    await grant(await student('Ana'), IN_JUNE);
    await grant(await student('Earlier'), new Date('2026-05-10T06:00:00.000Z'));

    const rows = tableOf(await read(REPORT_KEYS.MANUAL_GRANTS, JUNE), 'Grants');

    assert.deepEqual(
      rows.map((row) => [row.Student, row.By]),
      [['Ana', 'Front Desk']],
    );
  });
});

describe('the event candidates', () => {
  it('sets who registered beside who sat one of the event’s tests', async () => {
    const catalog = await makeCatalog(prisma);
    const event = await prisma.event.create({ data: { id: uid(), name: 'Scholarship test' } });
    await prisma.testSeries.update({
      where: { id: catalog.testSeriesId },
      data: { kind: TEST_SERIES_KIND.EVENT, eventId: event.id },
    });
    const test = await makeTest(prisma, catalog);
    const [ana, bala] = [await student('Ana'), await student('Bala')];
    await prisma.eventCandidate.createMany({
      data: [ana, bala].map((studentId) => ({ eventId: event.id, studentId })),
    });
    await makeSitting(prisma, { testId: test.id, studentId: ana, score: 30 });

    const document = await read(REPORT_KEYS.EVENT_CANDIDATES, { eventId: event.id });

    assert.equal(figureOf(document, 'Candidates'), 2);
    assert.equal(figureOf(document, 'Sat a test'), 1);
    assert.deepEqual(
      tableOf(document, 'Candidates').map((row) => [row.Student, row['Tests sat']]),
      [
        ['Ana', 1],
        ['Bala', 0],
      ],
    );
  });

  it('answers not found for an event that is not there', async () => {
    await assert.rejects(
      read(REPORT_KEYS.EVENT_CANDIDATES, { eventId: uid() }),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

describe('the mobile number changes', () => {
  it('sets the number a student used to have beside the one they have now', async () => {
    const ana = await student('Ana', { mobile: '9000000002' });
    await prisma.studentMobileHistory.create({
      data: { id: uid(), studentId: ana, mobile: '9000000001', createdAt: IN_JUNE },
    });

    const rows = tableOf(await read(REPORT_KEYS.MOBILE_CHANGES, JUNE), 'Mobile changes');

    assert.deepEqual(
      rows.map((row) => [row.Student, row['Old mobile'], row['Mobile now']]),
      [['Ana', '9000000001', '9000000002']],
    );
  });
});
