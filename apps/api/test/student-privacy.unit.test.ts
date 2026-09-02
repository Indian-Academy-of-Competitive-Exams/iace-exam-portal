import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, CONSENT_PURPOSE, ErrorCodes } from '@iace/contracts';
import { StudentPrivacyService } from '../src/students/student-privacy.service';
import { TOMBSTONE_MOBILE, anonymizedProfile } from '../src/students/anonymize';
import { EVERY_BRANCH } from '../src/common/security';
import {
  FakeConfig,
  FakePrivacyPrisma,
  makeBranch,
  makeStudent,
  type FakePrivacyWorld,
} from './support/fakes';

const NOTICE = '2026-09-01';

function build(world: FakePrivacyWorld = {}) {
  const prisma = new FakePrivacyPrisma(world);
  const service = new StudentPrivacyService(
    prisma.asService(),
    new FakeConfig({ CONSENT_VERSION: NOTICE }).asService(),
  );
  return { prisma, service };
}

describe('consent, as a record rather than a flag', () => {
  it('writes a row rather than editing the one before it', async () => {
    const { prisma, service } = build({ students: [makeStudent({ id: 'stu_1' })] });

    await service.record('stu_1', {
      purpose: CONSENT_PURPOSE.PLATFORM,
      version: NOTICE,
      granted: true,
    });
    await service.record('stu_1', {
      purpose: CONSENT_PURPOSE.PLATFORM,
      version: NOTICE,
      granted: false,
    });

    assert.equal(prisma.consents.length, 2);
    assert.deepEqual(
      prisma.consents.map((row) => row.granted),
      [true, false],
    );
  });

  /** The current state is the newest answer per purpose — a withdrawal, if that is the last word. */
  it('reports the newest answer, not the first one', async () => {
    const { service } = build({ students: [makeStudent({ id: 'stu_1' })] });

    await service.record('stu_1', {
      purpose: CONSENT_PURPOSE.PLATFORM,
      version: NOTICE,
      granted: true,
    });
    await service.record('stu_1', {
      purpose: CONSENT_PURPOSE.PLATFORM,
      version: NOTICE,
      granted: false,
    });

    const status = await service.status('stu_1');
    assert.equal(status.records.length, 1);
    assert.equal(status.records[0]?.granted, false);
  });

  /** How the SPA knows to ask again: the notice moved on and the newest record did not. */
  it('says which notice is in force, so a stale record shows as stale', async () => {
    const { service } = build({ students: [makeStudent({ id: 'stu_1' })] });

    await service.record('stu_1', {
      purpose: CONSENT_PURPOSE.PLATFORM,
      version: '2025-01-01',
      granted: true,
    });

    const status = await service.status('stu_1');
    assert.equal(status.current, NOTICE);
    assert.notEqual(status.records[0]?.version, status.current);
  });

  it('records the notice in force when a student signs up', async () => {
    const { prisma, service } = build({ students: [makeStudent({ id: 'stu_1' })] });

    await service.recordAtSignup('stu_1');

    assert.equal(prisma.consents[0]?.version, NOTICE);
    assert.equal(prisma.consents[0]?.granted, true);
  });

  /** A signup must never fail because a consent row would not write. */
  it('swallows a failed record rather than costing the account', async () => {
    const { prisma, service } = build({ students: [makeStudent({ id: 'stu_1' })], failing: true });

    await assert.doesNotReject(() => service.recordAtSignup('stu_1'));
    assert.equal(prisma.consents.length, 0);
  });
});

describe('the copy a student may take away', () => {
  it('carries the profile fields nothing else on the platform shows them', async () => {
    const { service } = build({
      students: [makeStudent({ id: 'stu_1', mobile: '9876543210', currentBranchId: 'br_1' })],
      branches: [makeBranch({ id: 'br_1', name: 'AMEERPET' })],
      profiles: [{ studentId: 'stu_1', motherName: 'Lakshmi', fatherName: 'Rao' }],
    });

    const copy = await service.export('stu_1');

    assert.equal(copy.student.mobile, '9876543210');
    assert.equal(copy.student.branch, 'AMEERPET');
    assert.equal(copy.profile?.motherName, 'Lakshmi');
    assert.ok(copy.exportedAt);
  });

  it('lists their sittings with the marks, and refuses somebody else’s id', async () => {
    const { service } = build({
      students: [makeStudent({ id: 'stu_1' })],
      attempts: [{ id: 'att_1', studentId: 'stu_1', testId: 'tst_1', score: 42 }],
    });

    const copy = await service.export('stu_1');
    assert.deepEqual(
      copy.attempts.map((attempt) => [attempt.id, attempt.score]),
      [['att_1', 42]],
    );

    await assert.rejects(service.export('stu_missing'), AppException.is);
  });
});

describe('erasure is anonymisation', () => {
  it('takes the person out of the row and leaves the row', async () => {
    const { prisma, service } = build({
      students: [makeStudent({ id: 'stu_1', mobile: '9876543210', fullName: 'Asha' })],
      profiles: [{ studentId: 'stu_1', motherName: 'Lakshmi', dob: new Date('2004-05-01') }],
      attempts: [{ id: 'att_1', studentId: 'stu_1', testId: 'tst_1', score: 42 }],
    });

    const receipt = await service.anonymize('stu_1', EVERY_BRANCH);

    const student = prisma.students[0]!;
    assert.equal(student.mobile, TOMBSTONE_MOBILE);
    assert.equal(student.fullName, null);
    assert.equal(student.pinHash, null);
    assert.equal(student.isActive, false);
    assert.ok(student.anonymizedAt);
    assert.ok(student.deletedAt);
    assert.equal(prisma.profiles[0]?.motherName, null);
    assert.equal(prisma.profiles[0]?.dob, null);

    // The whole point: a cohort's mean must not move because somebody exercised a right.
    assert.equal(prisma.attempts.length, 1);
    assert.equal(receipt.attemptsKept, 1);
  });

  /** Erasing twice would rewrite the date the promise was kept on. */
  it('refuses a student who has already been erased', async () => {
    const { service } = build({
      students: [makeStudent({ id: 'stu_1', anonymizedAt: new Date('2026-01-01') })],
    });

    await assert.rejects(service.anonymize('stu_1', EVERY_BRANCH), (error: unknown) => {
      assert.ok(AppException.is(error));
      assert.equal(error.code, ErrorCodes.CONFLICT);
      return true;
    });
  });

  /** Missing, not refused: an admin outside the branch learns nothing about who exists. */
  it('is a not-found for a student outside the admin’s branches', async () => {
    const { service } = build({
      students: [makeStudent({ id: 'stu_1', currentBranchId: 'br_other' })],
    });

    await assert.rejects(
      service.anonymize('stu_1', { all: false, branchIds: ['br_mine'] }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.NOT_FOUND);
        return true;
      },
    );
  });
});

describe('the tombstone', () => {
  /** A live mobile always starts 6-9, so nothing real can ever collide with the tombstone. */
  it('is a number no student can hold', () => {
    assert.match(TOMBSTONE_MOBILE, /^0+$/);
  });

  it('empties every field the profile holds about a person', () => {
    const scrubbed = anonymizedProfile();

    for (const field of ['motherName', 'fatherName', 'dob', 'email', 'address', 'gender']) {
      assert.equal(scrubbed[field as keyof typeof scrubbed], null, field);
    }
    assert.equal(scrubbed.aadhaarVerified, false);
    assert.equal(scrubbed.panVerified, false);
  });
});
