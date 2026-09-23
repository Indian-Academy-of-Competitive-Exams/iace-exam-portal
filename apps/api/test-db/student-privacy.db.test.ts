import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { AppException, ErrorCodes } from '@iace/contracts';
import { StudentPrivacyService } from '../src/students/student-privacy.service';
import { TOMBSTONE_MOBILE } from '../src/students/anonymize';
import { FakeLeaderboard, makeStanding } from '../test/support/fakes';
import {
  makeBranch,
  makeCatalog,
  makeSitting,
  makeStudent,
  makeTest,
  resetDatabase,
  testPrisma,
  uid,
} from './support/database';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const build = (leaderboard = new FakeLeaderboard()) =>
  new StudentPrivacyService(prisma, leaderboard.asService());

describe('the copy a student may take away', () => {
  it('carries the profile fields nothing else on the platform shows them', async () => {
    const service = build();
    const branch = await makeBranch(prisma, 'AMEERPET');
    const student = await makeStudent(prisma, {
      mobile: '9876543210',
      currentBranchId: branch.id,
    });
    await prisma.studentProfile.create({
      data: { studentId: student.id, motherName: 'Lakshmi', fatherName: 'Rao' },
    });

    const copy = await service.export(student.id);

    assert.equal(copy.student.mobile, '9876543210');
    assert.equal(copy.student.branch, 'AMEERPET');
    assert.equal(copy.profile?.motherName, 'Lakshmi');
    assert.ok(copy.exportedAt);
  });

  it('lists their sittings with the marks and the percentile each holds now, and refuses somebody else’s id', async () => {
    const student = await makeStudent(prisma);
    const test = await makeTest(prisma, await makeCatalog(prisma));
    const first = await makeSitting(prisma, {
      testId: test.id,
      studentId: student.id,
      score: 42,
      createdAt: new Date('2026-09-01T05:00:00.000Z'),
    });
    const retake = await makeSitting(prisma, {
      testId: test.id,
      studentId: student.id,
      score: 50,
      attemptNo: 2,
      isGraded: false,
      createdAt: new Date('2026-09-02T05:00:00.000Z'),
    });
    const service = build(
      new FakeLeaderboard([
        makeStanding({ attemptId: first.id, studentId: student.id, percentile: 62.5 }),
      ]),
    );

    const copy = await service.export(student.id);
    assert.deepEqual(
      copy.attempts.map((attempt) => [attempt.id, attempt.score, attempt.percentile]),
      [
        [first.id, 42, 62.5],
        [retake.id, 50, null],
      ],
    );

    await assert.rejects(service.export(uid()), AppException.is);
  });
});

describe('erasure is anonymisation', () => {
  it('takes the person out of the row and leaves the row', async () => {
    const service = build();
    const student = await makeStudent(prisma, { mobile: '9876543210', fullName: 'Asha' });
    await prisma.studentProfile.create({
      data: { studentId: student.id, motherName: 'Lakshmi', dob: new Date('2004-05-01') },
    });
    const test = await makeTest(prisma, await makeCatalog(prisma));
    await makeSitting(prisma, { testId: test.id, studentId: student.id, score: 42 });

    const receipt = await service.anonymize(student.id);

    const row = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    assert.equal(row.mobile, TOMBSTONE_MOBILE);
    assert.equal(row.fullName, null);
    assert.equal(row.pinHash, null);
    assert.equal(row.isActive, false);
    assert.ok(row.anonymizedAt);
    assert.ok(row.deletedAt);
    const profile = await prisma.studentProfile.findUniqueOrThrow({
      where: { studentId: student.id },
    });
    assert.equal(profile.motherName, null);
    assert.equal(profile.dob, null);

    // The whole point: a cohort's mean must not move because somebody exercised a right.
    assert.equal(await prisma.attempt.count({ where: { studentId: student.id } }), 1);
    assert.equal(receipt.attemptsKept, 1);
  });

  /** Erasing twice would rewrite the date the promise was kept on. */
  it('refuses a student who has already been erased', async () => {
    const service = build();
    const student = await makeStudent(prisma, { anonymizedAt: new Date('2026-01-01') });

    await assert.rejects(service.anonymize(student.id), (error: unknown) => {
      assert.ok(AppException.is(error));
      assert.equal(error.code, ErrorCodes.CONFLICT);
      return true;
    });
  });
});
