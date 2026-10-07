import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import { STUDENT_TYPE, readinessOf } from '@iace/contracts';
import { AuditService } from '../src/audit/audit.service';
import { ImportsService } from '../src/imports/imports.service';
import { FakeEventsService, FakeProgramsService, FakeStorage } from '../test/support/fakes';
import { makeBranch, makeStudent, resetDatabase, testPrisma } from './support/database';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const importer = () =>
  new ImportsService(
    prisma,
    new FakeStorage() as never,
    new AuditService(prisma, new FakeStorage() as never),
    new FakeEventsService().asService(),
    new FakeProgramsService().asService(),
  );

const HEADERS = 'Mobile Number,Student Type,Branch Name,Enrolled Courses,Enrolled Exams,Programs';

const sheet = (...rows: string[]) => Buffer.from([HEADERS, ...rows].join('\n'));

const ADMIN = randomUUID();

const withProfile = (...rows: string[]) =>
  Buffer.from([`${HEADERS},Date of Birth,Gender`, ...rows].join('\n'));

const branchOf = async (mobile: string) =>
  (await prisma.student.findFirstOrThrow({ where: { mobile } })).currentBranchId;

describe('the branch a roster import writes', () => {
  it('creates a NON-IACE student at no branch, and takes a re-imported one out of theirs', async () => {
    const branch = await makeBranch(prisma);
    await makeStudent(prisma, {
      mobile: '9000000001',
      studentType: STUDENT_TYPE.NON_IACE,
      currentBranchId: branch.id,
    });

    const result = await importer().commitStudents(
      sheet('9876543210,NON-IACE,,SSC,,', '9000000001,NON-IACE,,SSC,,'),
      ADMIN,
    );

    assert.equal(result.created, 1);
    assert.equal(result.updated, 1);
    assert.equal(await branchOf('9876543210'), null);
    assert.equal(await branchOf('9000000001'), null);
  });

  /** A branch reaches its series, so a NON-IACE row naming one put an outsider on a centre's tests. */
  it('refuses a NON-IACE row that names a branch, and writes nothing for it', async () => {
    const branch = await makeBranch(prisma, 'AMEERPET');
    await makeStudent(prisma, { mobile: '9000000001', studentType: STUDENT_TYPE.OFFLINE });
    const file = sheet('9876543210,NON-IACE,AMEERPET,SSC,,', '9000000001,NON-IACE,Ameerpet,SSC,,');

    const plan = await importer().previewStudents(file);
    const result = await importer().commitStudents(file, ADMIN);

    for (const row of plan.rows) {
      assert.match(row.errors.join(' '), /Non-IACE student has no branch/);
    }
    assert.equal(result.skipped, 2);
    assert.equal(await prisma.student.count({ where: { currentBranchId: branch.id } }), 0);
    assert.equal(
      (await prisma.student.findFirstOrThrow({ where: { mobile: '9000000001' } })).studentType,
      STUDENT_TYPE.OFFLINE,
    );
  });

  it('still refuses an OFFLINE row with no branch, and writes nothing for it', async () => {
    const result = await importer().commitStudents(sheet('9876543210,OFFLINE,,SSC,,'), ADMIN);

    assert.equal(result.skipped, 1);
    assert.equal(await prisma.student.count(), 0);
  });
});

describe('the readiness a roster import leaves', () => {
  const flagsOf = async (mobile: string) => {
    const row = await prisma.student.findFirstOrThrow({
      where: { mobile },
      include: { profile: true },
    });
    return readinessOf(row.profile);
  };

  it('completes a profile whose photo was already on file when the sheet fills DOB and gender', async () => {
    const student = await makeStudent(prisma, {
      mobile: '9000000001',
      studentType: STUDENT_TYPE.NON_IACE,
    });
    await prisma.studentProfile.create({
      data: { studentId: student.id, photoUrl: 'documents/photo.jpg' },
    });

    await importer().commitStudents(
      withProfile('9000000001,NON-IACE,,SSC,,,2003-04-11,FEMALE'),
      ADMIN,
    );

    assert.deepEqual(await flagsOf('9000000001'), { preTestReady: false, profileCompleted: true });
  });

  it("readies a student for a test when the sheet adds the DOB to both parents' names", async () => {
    const student = await makeStudent(prisma, {
      mobile: '9000000001',
      studentType: STUDENT_TYPE.NON_IACE,
    });
    await prisma.studentProfile.create({
      data: { studentId: student.id, motherName: 'Lakshmi', fatherName: 'Ravi' },
    });

    await importer().commitStudents(withProfile('9000000001,NON-IACE,,SSC,,,2003-04-11,'), ADMIN);

    assert.deepEqual(await flagsOf('9000000001'), { preTestReady: true, profileCompleted: false });
  });
});
