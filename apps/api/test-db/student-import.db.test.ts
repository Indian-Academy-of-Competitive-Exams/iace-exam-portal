import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import { IMPORT_LOG_STATUS, STUDENT_TYPE, readinessOf } from '@iace/contracts';
import { AuditService } from '../src/audit/audit.service';
import { ImportsService } from '../src/imports/imports.service';
import { type PrismaService } from '../src/prisma/prisma.service';
import { StudentPrivacyService } from '../src/students/student-privacy.service';
import {
  FakeEventBus,
  FakeEventsService,
  FakeProgramsService,
  FakeStorage,
} from '../test/support/fakes';
import { makeBranch, makeStudent, resetDatabase, testPrisma } from './support/database';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const importer = (client: PrismaService = prisma) =>
  new ImportsService(
    client,
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

/** The real database, with `meanwhile` landing around one `student` call: before it goes out, or after it answers. */
function around(
  method: 'create' | 'findMany',
  when: 'before' | 'after',
  meanwhile: () => Promise<unknown>,
): PrismaService {
  const students = new Proxy(prisma.student, {
    get(target, key, receiver) {
      if (key !== method) return Reflect.get(target, key, receiver) as unknown;
      const real = target[method] as (args: unknown) => Promise<unknown>;
      return async (args: unknown) => {
        if (when === 'before') await meanwhile();
        const answer = await real(args);
        if (when === 'after') await meanwhile();
        return answer;
      };
    },
  });
  return new Proxy(prisma, {
    get: (target, key, receiver) =>
      key === 'student' ? students : (Reflect.get(target, key, receiver) as unknown),
  });
}

const runStatuses = async () => (await prisma.importLog.findMany()).map((log) => log.status);

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

describe('a number that appeared after the run was planned', () => {
  const NEW_ROWS = ['9876543210,NON-IACE,,SSC,,', '9000000002,NON-IACE,,RRB,,'];

  /** The failure this prevents: one number added by hand mid-run failing the whole file and stranding the rows after it. */
  it('writes the row onto whoever took the number, and carries on with the rows after it', async () => {
    let added = false;
    const byHand = async () => {
      if (added) return;
      added = true;
      await makeStudent(prisma, { mobile: '9876543210', enrolledCourses: ['BANKING'] });
    };

    const result = await importer(around('create', 'before', byHand)).commitStudents(
      sheet(...NEW_ROWS),
      ADMIN,
    );

    assert.deepEqual([result.created, result.updated], [1, 1]);
    assert.deepEqual(await runStatuses(), [IMPORT_LOG_STATUS.COMMITTED]);
    const taken = await prisma.student.findMany({ where: { mobile: '9876543210' } });
    assert.equal(taken.length, 1);
    assert.deepEqual([...(taken[0]?.enrolledCourses ?? [])].sort(), ['BANKING', 'SSC']);
    assert.equal(await prisma.student.count({ where: { mobile: '9000000002' } }), 1);
  });

  it('finishes both runs when two admins import the same new students together', async () => {
    const file = sheet(...NEW_ROWS, '9000000003,NON-IACE,,SSC,,');

    await Promise.all([
      importer().commitStudents(file, ADMIN),
      importer().commitStudents(file, ADMIN),
    ]);

    assert.deepEqual(await runStatuses(), [
      IMPORT_LOG_STATUS.COMMITTED,
      IMPORT_LOG_STATUS.COMMITTED,
    ]);
    const students = await prisma.student.findMany({ select: { enrolledCourses: true } });
    assert.equal(students.length, 3);
    assert.ok(
      students.every((student) => student.enrolledCourses.length === 1),
      'held once each',
    );
  });
});

describe('a roster import adds to what a student holds as it writes', () => {
  /** The failure this prevents: a program another admin added while a long file ran, overwritten by lists worked out when it began. */
  it('keeps an enrolment made between the plan and the write, and adds nothing twice', async () => {
    const student = await makeStudent(prisma, {
      mobile: '9000000001',
      studentType: STUDENT_TYPE.NON_IACE,
      programs: ['SSC FOUNDATION'],
      enrolledExams: ['SSC CGL'],
    });
    await prisma.exam.create({ data: { course: 'RRB', code: 'RRB JE', name: 'RRB JE' } });
    const elsewhere = () =>
      prisma.student.update({
        where: { id: student.id },
        data: {
          programs: { set: ['BANK PO BATCH'] },
          enrolledExams: { push: 'RRB JE' },
          enrolledCourses: { push: 'BANKING' },
        },
      });
    const file = sheet('9000000001,NON-IACE,,SSC,RRB JE,');

    await importer(around('findMany', 'after', elsewhere)).commitStudents(file, ADMIN);
    await importer().commitStudents(file, ADMIN);

    const row = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    assert.deepEqual(row.programs, ['BANK PO BATCH'], 'a program taken off mid-run stays off');
    assert.deepEqual([...row.enrolledExams].sort(), ['RRB JE', 'SSC CGL']);
    assert.deepEqual([...row.enrolledCourses].sort(), ['BANKING', 'SSC']);
  });
});

describe('a student erased around a roster import', () => {
  const file = Buffer.from(
    [
      `${HEADERS},Full Name,Date of Birth`,
      '9000000001,NON-IACE,,SSC,,,Asha Rani,2004-05-01',
      '9000000002,NON-IACE,,RRB,,,Bala,2003-01-02',
    ].join('\n'),
  );
  const known = () =>
    makeStudent(prisma, { mobile: '9000000001', studentType: STUDENT_TYPE.NON_IACE });
  const erase = (id: string) =>
    new StudentPrivacyService(
      prisma,
      new FakeEventBus().asService(),
      new FakeStorage() as never,
    ).anonymize(id);
  /** Everything the sheet could have put back: the name, the profile, an enrolment. */
  const writtenBack = async (id: string) => {
    const row = await prisma.student.findUniqueOrThrow({
      where: { id },
      include: { profile: true },
    });
    return [row.fullName, row.profile, row.enrolledCourses];
  };

  it('writes nothing back when the erasure lands between the preview and the commit', async () => {
    const student = await known();
    await importer().previewStudents(file);
    await erase(student.id);

    await importer().commitStudents(file, ADMIN);

    assert.deepEqual(await writtenBack(student.id), [null, null, []]);
  });

  /** The failure this prevents: name, date of birth and enrolments put back on a tombstone that can never be erased again. */
  it('skips the row of a student erased while the run was writing, says why, and carries on', async () => {
    const student = await known();
    let erased = false;
    const eraseOnce = async () => {
      if (erased) return;
      erased = true;
      await erase(student.id);
    };

    const result = await importer(around('findMany', 'after', eraseOnce)).commitStudents(
      file,
      ADMIN,
    );

    assert.deepEqual(await writtenBack(student.id), [null, null, []]);
    assert.deepEqual([result.created, result.updated, result.skipped], [1, 0, 1]);
    const [log] = await prisma.importLog.findMany();
    assert.deepEqual([log?.status, log?.skipped, log?.failed], [IMPORT_LOG_STATUS.COMMITTED, 1, 0]);
    const { rowErrors } = log?.errors as { rowErrors: { line: number; error: string }[] };
    assert.deepEqual(
      rowErrors.map((row) => row.line),
      [2],
    );
    assert.match(rowErrors[0]?.error ?? '', /erased/);
    assert.equal(await prisma.rowActionLog.count({ where: { entityId: student.id } }), 0);
  });

  /** The failure this prevents: a row left with its name written and its enrolments not, and no audit entry for either. */
  it('writes none of a row when the second half of its write fails', async () => {
    const student = await known();
    const appendFails = new Proxy(prisma, {
      get: (target, key, receiver) =>
        key === '$executeRaw'
          ? () => target.$executeRaw`SELECT 1 / 0`
          : (Reflect.get(target, key, receiver) as unknown),
    });

    await assert.rejects(importer(appendFails).commitStudents(file, ADMIN), /division by zero/);

    assert.deepEqual(await writtenBack(student.id), ['Database Tier Student', null, []]);
  });
});
