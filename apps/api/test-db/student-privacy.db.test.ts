import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { AppException, ErrorCodes, readinessOf } from '@iace/contracts';
import { StudentPrivacyService } from '../src/students/student-privacy.service';
import { TOMBSTONE_MOBILE } from '../src/students/anonymize';
import { DOMAIN_EVENTS } from '../src/common/events';
import { FakeEventBus, FakeStorage } from '../test/support/fakes';
import {
  makeCatalog,
  makeSitting,
  makeStudent,
  makeTest,
  resetDatabase,
  testPrisma,
} from './support/database';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const build = (events = new FakeEventBus(), storage = new FakeStorage()) =>
  new StudentPrivacyService(prisma, events.asService(), storage as never);

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

  it('leaves neither readiness flag set on a profile it emptied', async () => {
    const student = await makeStudent(prisma);
    await prisma.studentProfile.create({
      data: {
        studentId: student.id,
        motherName: 'Lakshmi',
        fatherName: 'Ravi',
        dob: new Date('2003-04-11'),
        gender: 'FEMALE',
        photoUrl: 'documents/photo.jpg',
      },
    });

    await build().anonymize(student.id);

    const row = await prisma.student.findUniqueOrThrow({
      where: { id: student.id },
      include: { profile: true },
    });
    assert.deepEqual(readinessOf(row.profile), { preTestReady: false, profileCompleted: false });
  });

  /** The bug this prevents: an erased account still answering with its live token. */
  it('asks for the sessions to go, the same signal a deactivation sends', async () => {
    const events = new FakeEventBus();
    const service = build(events);
    const student = await makeStudent(prisma);

    await service.anonymize(student.id);

    assert.deepEqual(events.of(DOMAIN_EVENTS.STUDENT_DEACTIVATED), [{ studentId: student.id }]);
  });

  /** The bug this prevents: the photo and the marksheet outliving the erasure, under the student's own id. */
  it('takes the uploaded documents out of storage, not just their keys off the row', async () => {
    const storage = new FakeStorage();
    const student = await makeStudent(prisma);
    const photo = `students/${student.id}/photo-1.jpg`;
    const marksheet = `students/${student.id}/tenth-marksheet-1.pdf`;
    await storage.upload(photo, Buffer.from('a face'));
    await storage.upload(marksheet, Buffer.from('a marksheet'));
    await prisma.studentProfile.create({
      data: { studentId: student.id, photoUrl: photo, tenthMarksheetUrl: marksheet },
    });

    await build(new FakeEventBus(), storage).anonymize(student.id);

    assert.deepEqual([...storage.objects.keys()], []);
  });

  /** Reporting a successful erasure over files that are still there is the one outcome worth refusing. */
  it('erases nothing if the documents cannot be removed', async () => {
    const storage = new FakeStorage();
    const student = await makeStudent(prisma, { fullName: 'Asha' });
    await storage.upload('students/photo.jpg', Buffer.from('a face'));
    await prisma.studentProfile.create({
      data: { studentId: student.id, photoUrl: 'students/photo.jpg' },
    });
    storage.failNextRemove = true;

    await assert.rejects(build(new FakeEventBus(), storage).anonymize(student.id));

    const row = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    assert.equal(row.fullName, 'Asha');
    assert.equal(row.anonymizedAt, null);
  });

  /** The failure this prevents: an erased student still found by a number they once signed in with. */
  it('forgets the numbers they used to sign in with', async () => {
    const service = build();
    const student = await makeStudent(prisma, { mobile: '9876543210' });
    await prisma.studentMobileHistory.create({
      data: { studentId: student.id, mobile: '9123456780' },
    });

    await service.anonymize(student.id);

    assert.equal(await prisma.studentMobileHistory.count({ where: { studentId: student.id } }), 0);
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
