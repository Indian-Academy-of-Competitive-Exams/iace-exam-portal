import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AppException,
  BRANCH_TYPE,
  EXAM_COURSE,
  ErrorCodes,
  STUDENT_TYPE,
  studentSittingsQuerySchema,
  studentListQuerySchema,
} from '@iace/contracts';
import { ProgramsService } from '../src/access/programs.service';
import { AuditContext } from '../src/audit';
import { NotificationsService } from '../src/notifications/notifications.service';
import { BranchesService } from '../src/branches/branches.service';
import { DOMAIN_EVENTS } from '../src/common/events';
import { type ExamsService } from '../src/configs';
import { type StorageService } from '../src/storage/storage.service';
import { type PrismaService } from '../src/prisma/prisma.service';
import { StudentsService } from '../src/students/students.service';
import {
  FakeCodeCatalog,
  FakeEventBus,
  FakeMessageSender,
  FakeStorage,
} from '../test/support/fakes';
import {
  makeCatalog,
  makeSitting,
  makeStudent,
  makeTest,
  resetDatabase,
  testPrisma,
  type StudentOverrides,
} from './support/database';

const STUDENT = randomUUID();

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** `enrolledExams` is free text with no foreign key, so nothing but this service stops a typo; the catalog is its seam. */
class FakeExams {
  readonly calls: { codes: string[]; fieldKey: string }[] = [];

  constructor(private readonly usable: string[] = []) {}

  assertUsable(codes: string[], fieldKey: string): Promise<void> {
    this.calls.push({ codes, fieldKey });
    const unknown = codes.filter((code) => !this.usable.includes(code));
    if (unknown.length > 0) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'No such exam', {
        fieldErrors: { [fieldKey]: ['No such exam'] },
      });
    }
    return Promise.resolve();
  }

  namesByCode(codes: readonly string[]): Promise<Map<string, string>> {
    return Promise.resolve(
      new Map(
        codes.filter((code) => this.usable.includes(code)).map((code) => [code, `${code} name`]),
      ),
    );
  }

  asService(): ExamsService {
    return this as unknown as ExamsService;
  }
}

const PHYSICAL = { id: randomUUID(), name: 'AMEERPET', type: BRANCH_TYPE.PHYSICAL };
const ONLINE_BRANCH = { id: randomUUID(), name: 'ONLINE', type: BRANCH_TYPE.VIRTUAL };

interface Bench {
  /** The student, `stu_1`, unless the case is about creating one. */
  student?: StudentOverrides | null;
  branches?: { id: string; name: string; type: string; isActive?: boolean }[];
  /** The live catalog instead of the fake, for a case that turns on a program being retired. */
  realPrograms?: boolean;
  /** The real client behind a Proxy, for a case that turns on what lands between a read and a write. */
  client?: PrismaService;
}

/** The real database, with `meanwhile` landing after each `student.findFirst` and before its caller acts. */
function afterEachStudentRead(meanwhile: () => Promise<void>): PrismaService {
  const students = new Proxy(prisma.student, {
    get(target, method, receiver) {
      if (method !== 'findFirst') return Reflect.get(target, method, receiver) as unknown;
      return async (args: Parameters<typeof target.findFirst>[0]) => {
        const found = await target.findFirst(args);
        await meanwhile();
        return found;
      };
    },
  });
  return new Proxy(prisma, {
    get: (target, key, receiver) =>
      key === 'student' ? students : (Reflect.get(target, key, receiver) as unknown),
  });
}

async function serviceWith(over: Bench = {}) {
  await prisma.branch.createMany({
    data: (over.branches ?? [PHYSICAL]).map((branch) => ({
      ...branch,
      type: branch.type as typeof BRANCH_TYPE.PHYSICAL,
    })),
  });
  if (over.student !== null) await makeStudent(prisma, { id: STUDENT, ...over.student });
  const exams = new FakeExams(['SSC CGL', 'RRB JE']);
  const programs = new FakeCodeCatalog(['SSC CGL FOUNDATION']);
  const events = new FakeEventBus();
  const sender = new FakeMessageSender();
  const auditContext = new AuditContext();
  const storage = new FakeStorage();
  return {
    exams,
    programs,
    events,
    sender,
    auditContext,
    storage,
    service: new StudentsService(
      over.client ?? prisma,
      storage as unknown as StorageService,
      exams.asService(),
      new BranchesService(prisma, new AuditContext()),
      over.realPrograms ? new ProgramsService(prisma, auditContext) : programs.asService(),
      auditContext,
      events.asService(),
      new NotificationsService(prisma),
    ),
  };
}

const noStudentYet = { student: null };

const row = () => prisma.student.findUniqueOrThrow({ where: { id: STUDENT } });

const onlyStudent = () => prisma.student.findFirstOrThrow();

const refusedOn =
  (field: string, code: string = ErrorCodes.VALIDATION_ERROR) =>
  (error: unknown) =>
    AppException.is(error) && error.code === code && Boolean(error.fieldErrors?.[field]);

describe('StudentsService.list — access of their own, one rule for the filter and the badge', () => {
  /** The failure this prevents: the badge (exams only) and the filter beside it (exams or programs) disagreeing, and both disagreeing with the resolver. */
  it('counts a grant and a course at a branch, and not an exam alone', async () => {
    const { service } = await serviceWith({ student: null });
    const examOnly = await makeStudent(prisma, { enrolledExams: ['SSC CGL'] });
    const granted = await makeStudent(prisma);
    const catalog = await makeCatalog(prisma);
    await prisma.studentGrant.create({
      data: { studentId: granted.id, testSeriesId: catalog.testSeriesId },
    });
    const placed = await makeStudent(prisma, {
      currentBranchId: PHYSICAL.id,
      enrolledCourses: ['SSC'],
    });

    const listed = await service.list(studentListQuerySchema.parse({}));
    const own = new Map(listed.items.map((student) => [student.id, student.hasOwnAccess]));
    assert.deepEqual(
      [own.get(examOnly.id), own.get(granted.id), own.get(placed.id)],
      [false, true, true],
    );

    const none = await service.list(studentListQuerySchema.parse({ noAccess: 'true' }));
    assert.deepEqual(
      none.items.map((student) => student.id),
      [examOnly.id],
    );
  });
});

/** The flags are read off the profile, so the filter, the row's badge and the detail cannot disagree with it. */
describe('StudentsService — readiness read off the profile', () => {
  const parents = { motherName: 'Lakshmi', fatherName: 'Ravi', dob: new Date('2003-04-11') };

  it('filters and shows each flag by its own fields, a student with no profile row as neither', async () => {
    const { service } = await serviceWith({ student: null });
    const bare = await makeStudent(prisma);
    const preTest = await makeStudent(prisma);
    const complete = await makeStudent(prisma);
    await prisma.studentProfile.createMany({
      data: [
        { studentId: preTest.id, ...parents },
        { studentId: complete.id, ...parents, gender: 'FEMALE', photoUrl: 'documents/photo.jpg' },
      ],
    });
    const listed = (filters: Record<string, string>) =>
      service
        .list(studentListQuerySchema.parse(filters))
        .then((page) => page.items.map((student) => student.id).toSorted());

    assert.deepEqual(await listed({ preTestReady: 'true' }), [preTest.id, complete.id].toSorted());
    assert.deepEqual(await listed({ preTestReady: 'false' }), [bare.id]);
    assert.deepEqual(await listed({ profileCompleted: 'true' }), [complete.id]);
    assert.deepEqual(await listed({ profileCompleted: 'false' }), [bare.id, preTest.id].toSorted());

    const flags = async (id: string) => {
      const detail = await service.detail(id);
      return [detail.preTestReady, detail.profileCompleted];
    };
    assert.deepEqual(await flags(bare.id), [false, false]);
    assert.deepEqual(await flags(preTest.id), [true, false]);
    assert.deepEqual(await flags(complete.id), [true, true]);
  });

  /** THE failure a stored flag allowed: a profile saved without restating it left the badge stale. */
  it('reads a profile edit straight back, with nothing else to keep in step', async () => {
    const { service } = await serviceWith();

    const saved = await service.update(STUDENT, {
      profile: { motherName: 'Lakshmi', fatherName: 'Ravi', dob: '2003-04-11' },
    });
    const cleared = await service.update(STUDENT, { profile: { motherName: null } });

    assert.deepEqual([saved.preTestReady, cleared.preTestReady], [true, false]);
  });
});

describe('StudentsService.enrolmentOf — what a student reads on their own profile', () => {
  it('resolves every code the student carries to the catalog name for it', async () => {
    const { service } = await serviceWith();

    const enrolment = await service.enrolmentOf({
      enrolledExams: ['SSC CGL'],
      programs: ['SSC CGL FOUNDATION'],
      currentBranchId: PHYSICAL.id,
    });

    assert.deepEqual(enrolment.exams, [{ code: 'SSC CGL', name: 'SSC CGL name' }]);
    assert.deepEqual(enrolment.programs, [
      { code: 'SSC CGL FOUNDATION', name: 'SSC CGL FOUNDATION name' },
    ]);
    assert.equal(enrolment.branch, PHYSICAL.name);
  });

  /** The failure this prevents: a catalog row deleted under the student blanking their own row. */
  it('falls back to the code itself when the catalog no longer holds it', async () => {
    const { service } = await serviceWith();

    const enrolment = await service.enrolmentOf({
      enrolledExams: ['SSC CHSL'],
      programs: [],
      currentBranchId: null,
    });

    assert.deepEqual(enrolment.exams, [{ code: 'SSC CHSL', name: 'SSC CHSL' }]);
    assert.equal(enrolment.branch, null);
  });
});

describe('StudentsService.create — the type is the caller’s, never the service’s', () => {
  it('stores the type the request asked for, with the enrolments, the programme and the branch', async () => {
    const { service } = await serviceWith(noStudentYet);

    await service.create({
      mobile: '9000000002',
      studentType: STUDENT_TYPE.OFFLINE,
      enrolledExams: ['SSC CGL'],
      enrolledCourses: [EXAM_COURSE.SSC],
      programs: ['SSC CGL FOUNDATION'],
      currentBranchId: PHYSICAL.id,
    });

    const stored = await onlyStudent();
    assert.equal(stored.studentType, STUDENT_TYPE.OFFLINE);
    assert.deepEqual(stored.enrolledExams, ['SSC CGL']);
    assert.deepEqual(stored.enrolledCourses, [EXAM_COURSE.SSC]);
    assert.deepEqual(stored.programs, ['SSC CGL FOUNDATION']);
    assert.equal(stored.currentBranchId, PHYSICAL.id);
  });

  it('refuses an online student at a physical centre, and an offline one in the online branch', async () => {
    const { service } = await serviceWith({ ...noStudentYet, branches: [PHYSICAL, ONLINE_BRANCH] });

    await assert.rejects(
      () =>
        service.create({
          mobile: '9000000010',
          studentType: STUDENT_TYPE.ONLINE,
          currentBranchId: PHYSICAL.id,
        }),
      refusedOn('currentBranchId'),
    );
    await assert.rejects(
      () =>
        service.create({
          mobile: '9000000012',
          studentType: STUDENT_TYPE.OFFLINE,
          currentBranchId: ONLINE_BRANCH.id,
        }),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.VALIDATION_ERROR,
    );
  });

  it('takes an online student in the online branch, and a non-IACE one at none', async () => {
    const { service } = await serviceWith({ ...noStudentYet, branches: [PHYSICAL, ONLINE_BRANCH] });

    await service.create({
      mobile: '9000000011',
      studentType: STUDENT_TYPE.ONLINE,
      currentBranchId: ONLINE_BRANCH.id,
    });
    await service.create({ mobile: '9000000013', studentType: STUDENT_TYPE.NON_IACE });

    assert.equal(await prisma.student.count({ where: { currentBranchId: ONLINE_BRANCH.id } }), 1);
    assert.equal(await prisma.student.count({ where: { currentBranchId: null } }), 1);
  });

  /** The form no longer sends it: the server is the one place an online student is put in the online branch. */
  it('puts an online student naming no branch in the online branch, and refuses one while none exists', async () => {
    const { service } = await serviceWith(noStudentYet);
    const online = { mobile: '9000000016', studentType: STUDENT_TYPE.ONLINE };

    await assert.rejects(() => service.create(online), refusedOn('currentBranchId'));
    assert.equal(await prisma.student.count(), 0, 'nothing was written');

    await prisma.branch.create({ data: ONLINE_BRANCH });
    assert.equal((await service.create(online)).currentBranchId, ONLINE_BRANCH.id);
  });

  /** A branch reaches its series, so a non-IACE student put at one reached that centre's tests. */
  it('refuses a non-IACE student at any branch, under the branch field', async () => {
    const { service } = await serviceWith({ ...noStudentYet, branches: [PHYSICAL, ONLINE_BRANCH] });

    for (const [mobile, currentBranchId] of [
      ['9000000014', PHYSICAL.id],
      ['9000000015', ONLINE_BRANCH.id],
    ] as const) {
      await assert.rejects(
        () => service.create({ mobile, studentType: STUDENT_TYPE.NON_IACE, currentBranchId }),
        refusedOn('currentBranchId'),
      );
    }
    assert.equal(await prisma.student.count(), 0, 'nothing was written');
  });

  /** An exam code the catalog does not hold would resolve to no group while the screen reports success. */
  it('refuses an unknown exam, a missing branch and a retired one, each under the form’s own field', async () => {
    const { service } = await serviceWith({
      ...noStudentYet,
      branches: [{ ...PHYSICAL, isActive: false }],
    });

    await assert.rejects(
      () =>
        service.create({
          mobile: '9000000003',
          studentType: STUDENT_TYPE.ONLINE,
          enrolledExams: ['SSC CGI'],
        }),
      refusedOn('enrolledExams'),
    );
    for (const currentBranchId of [randomUUID(), PHYSICAL.id]) {
      await assert.rejects(
        () =>
          service.create({
            mobile: '9000000004',
            studentType: STUDENT_TYPE.ONLINE,
            currentBranchId,
          }),
        refusedOn('currentBranchId'),
      );
    }
    assert.equal(await prisma.student.count(), 0, 'nothing was written');
  });

  /** `Student.programs` holds a code with no foreign key, so a typo is a student who reaches no series. */
  it('refuses a program the catalog does not hold, under the form’s own field name', async () => {
    const { service } = await serviceWith(noStudentYet);

    await assert.rejects(
      () =>
        service.create({
          mobile: '9000000009',
          studentType: STUDENT_TYPE.ONLINE,
          programs: ['NOT A PROGRAM'],
        }),
      refusedOn('programs'),
    );
  });
});

describe('StudentsService.create — a number taken a moment ago', () => {
  const body = { mobile: '9876543210', studentType: STUDENT_TYPE.NON_IACE };

  /** The failure this prevents: the live-unique index answering "That already exists" with no field to put it under. */
  it('reads "Already registered" under the mobile field when the number went between the check and the write', async () => {
    let taken = false;
    const takeOnce = async () => {
      if (taken) return;
      taken = true;
      await makeStudent(prisma, { mobile: body.mobile });
    };
    const { service } = await serviceWith({
      ...noStudentYet,
      client: afterEachStudentRead(takeOnce),
    });

    await assert.rejects(() => service.create(body), refusedOn('mobile', ErrorCodes.CONFLICT));
    assert.equal(await prisma.student.count(), 1);
  });
});

describe('StudentsService — an erased student takes no further writes', () => {
  const ERASED = { deletedAt: new Date(), anonymizedAt: new Date(), isActive: false };
  const notFound = (error: unknown) =>
    AppException.is(error) && error.code === ErrorCodes.NOT_FOUND;

  /** The failure this prevents: a name typed back onto a tombstone, or sign-in "restored" on it. */
  it('refuses an edit, the sign-in switch and the test block, and changes nothing', async () => {
    const { service } = await serviceWith({ student: { fullName: null, ...ERASED } });

    await assert.rejects(
      () => service.update(STUDENT, { fullName: 'Asha', profile: { motherName: 'Lakshmi' } }),
      notFound,
    );
    await assert.rejects(() => service.setActive(STUDENT, true), notFound);
    await assert.rejects(() => service.setTestBlocked(STUDENT, true), notFound);

    const kept = await row();
    assert.deepEqual([kept.fullName, kept.isActive, kept.isTestBlocked], [null, false, false]);
    assert.equal(await prisma.studentProfile.count(), 0);
  });

  /** The failure this prevents: an upload in flight as the erasure lands, its key left on the tombstone and its file in storage. */
  it('refuses a document for an erased student, and takes the uploaded file back out of storage', async () => {
    const { service, storage } = await serviceWith({ student: { fullName: null, ...ERASED } });
    const key = `students/${STUDENT}/photo-1.jpg`;
    await storage.upload(key, Buffer.from('a face'));

    await assert.rejects(() => service.assertExists(STUDENT), notFound);
    await assert.rejects(() => service.saveDocumentKey(STUDENT, 'photoUrl', key), notFound);

    assert.equal(await prisma.studentProfile.count(), 0);
    assert.deepEqual([...storage.objects.keys()], []);
  });

  /** A form opened before the erasure, saved as the erasure lands: the write itself has to refuse. */
  it('writes nothing when the erasure lands between the read and the write', async () => {
    let armed = false;
    const eraseOnce = async () => {
      if (!armed) return;
      armed = false;
      await prisma.student.update({
        where: { id: STUDENT },
        data: { fullName: null, ...ERASED },
      });
    };
    const { service } = await serviceWith({
      student: { fullName: 'Asha' },
      client: afterEachStudentRead(eraseOnce),
    });
    const writes = [
      () => service.update(STUDENT, { fullName: 'Asha Rani' }),
      () => service.setActive(STUDENT, true),
      () => service.setTestBlocked(STUDENT, true),
    ];

    for (const write of writes) {
      await prisma.student.update({ where: { id: STUDENT }, data: { deletedAt: null } });
      armed = true;
      await assert.rejects(write);
      const kept = await row();
      assert.deepEqual([kept.fullName, kept.isActive, kept.isTestBlocked], [null, false, false]);
    }
  });
});

describe('StudentsService.update — an exam added again is told again', () => {
  const enrolmentNotices = () => prisma.notification.count({ where: { studentId: STUDENT } });

  /** The failure this prevents: a key naming the exam, so the second enrolment was swallowed as a replay of the first. */
  it('tells the student each time an exam is added, and not when a save adds none', async () => {
    const { service } = await serviceWith({ student: { enrolledExams: [] } });

    await service.update(STUDENT, { enrolledExams: ['SSC CGL'] });
    await service.update(STUDENT, { enrolledExams: ['SSC CGL'] });
    assert.equal(await enrolmentNotices(), 1, 'saved again with nothing added');

    await service.update(STUDENT, { enrolledExams: [] });
    await service.update(STUDENT, { enrolledExams: ['SSC CGL'] });
    assert.equal(await enrolmentNotices(), 2, 'taken off and added again');
  });
});

describe('StudentsService.update — a save from a form read before another write', () => {
  const stale = (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT;

  /** The failure this prevents: a page opened before a rename put the old name back under "Saved." */
  it('is refused once the student has moved since the form was read, and what moved stands', async () => {
    const { service } = await serviceWith({ student: { fullName: 'Asha' } });
    const opened = await service.detail(STUDENT);
    await service.update(STUDENT, { fullName: 'Asha Rani' });

    await assert.rejects(
      () =>
        service.update(STUDENT, {
          fullName: 'Asha',
          profile: { email: 'asha@example.com' },
          expectedUpdatedAt: opened.updatedAt,
        }),
      stale,
    );

    assert.equal((await row()).fullName, 'Asha Rani');
    assert.equal(await prisma.studentProfile.count(), 0);
  });

  /** Each save carries only what was changed, so the second, read after the first, leaves the first one's field alone. */
  it('lands on the stamp the record holds, moves it, and keeps both of two saves to different fields', async () => {
    const { service } = await serviceWith({ student: { fullName: 'Asha' } });
    const opened = await service.detail(STUDENT);

    const renamed = await service.update(STUDENT, {
      fullName: 'Asha Rani',
      expectedUpdatedAt: opened.updatedAt,
    });
    const filled = await service.update(STUDENT, {
      profile: { email: 'asha@example.com' },
      expectedUpdatedAt: renamed.updatedAt,
    });

    assert.notEqual(renamed.updatedAt, opened.updatedAt);
    assert.notEqual(filled.updatedAt, renamed.updatedAt, 'a profile field moves the stamp too');
    assert.deepEqual([filled.fullName, filled.profile?.email], ['Asha Rani', 'asha@example.com']);
  });

  /** A phone build from before the stamp sends none, and has to go on saving. */
  it('saves a patch that carries no stamp, whatever has moved since', async () => {
    const { service } = await serviceWith({ student: { fullName: 'Asha' } });
    await service.setTestBlocked(STUDENT, true);

    const saved = await service.update(STUDENT, { profile: { motherName: 'Lakshmi' } });

    assert.equal(saved.profile?.motherName, 'Lakshmi');
  });

  /** The stamp is checked on a read; only the write refusing closes the gap between the two. */
  it('writes nothing when another save lands between its read and its write', async () => {
    let armed = true;
    const renameOnce = async () => {
      if (!armed) return;
      armed = false;
      await prisma.student.update({ where: { id: STUDENT }, data: { fullName: 'Asha Rani' } });
    };
    const { service } = await serviceWith({
      student: { fullName: 'Asha' },
      client: afterEachStudentRead(renameOnce),
    });

    await assert.rejects(
      () => service.update(STUDENT, { fullName: 'Asha', profile: { motherName: 'Lakshmi' } }),
      stale,
    );

    assert.equal((await row()).fullName, 'Asha Rani');
    assert.equal(await prisma.studentProfile.count(), 0);
  });
});

describe('StudentsService.update — the access fields', () => {
  it('replaces the courses wholesale, down to none, and leaves them alone when the patch omits them', async () => {
    const { service } = await serviceWith({
      student: { enrolledCourses: [EXAM_COURSE.SSC, EXAM_COURSE.RRB] },
    });

    await service.update(STUDENT, { enrolledCourses: [EXAM_COURSE.RRB] });
    assert.deepEqual((await row()).enrolledCourses, [EXAM_COURSE.RRB]);

    await service.update(STUDENT, { fullName: 'Ravi Kumar' });
    assert.deepEqual((await row()).enrolledCourses, [EXAM_COURSE.RRB]);
  });

  it('replaces the enrolments and validates them first', async () => {
    const { service, exams } = await serviceWith({ student: { enrolledExams: ['SSC CGL'] } });

    await service.update(STUDENT, { enrolledExams: ['RRB JE'] });

    assert.deepEqual((await row()).enrolledExams, ['RRB JE']);
    assert.deepEqual(exams.calls.at(-1), { codes: ['RRB JE'], fieldKey: 'enrolledExams' });
  });

  it('validates the programs a patch names, not the ones already stored', async () => {
    const { service, programs } = await serviceWith({
      student: { programs: ['SSC CGL FOUNDATION'] },
    });

    await service.update(STUDENT, { fullName: 'Ravi Kumar' });

    assert.deepEqual(programs.calls, [], 'an untouched list is not re-checked');
  });

  it('clears the enrolments, the programs and the branch when the patch says so, and leaves them otherwise', async () => {
    const { service } = await serviceWith({
      student: {
        enrolledExams: ['SSC CGL'],
        programs: ['SSC CGL FOUNDATION'],
        currentBranchId: PHYSICAL.id,
        studentType: STUDENT_TYPE.OFFLINE,
      },
    });

    await service.update(STUDENT, { fullName: 'Ravi Kumar' });
    const untouched = await row();
    assert.deepEqual(untouched.enrolledExams, ['SSC CGL']);
    assert.deepEqual(untouched.programs, ['SSC CGL FOUNDATION']);

    await service.update(STUDENT, { enrolledExams: [], programs: [], currentBranchId: null });
    const cleared = await row();
    assert.deepEqual(
      [cleared.enrolledExams, cleared.programs, cleared.currentBranchId],
      [[], [], null],
    );
  });

  /** A wrong roster sheet tagged students for good; the student screen is where a program comes off. */
  it('takes one program off while a retired one stays held, and refuses a code the catalog does not hold', async () => {
    await prisma.program.createMany({
      data: [
        { code: 'SSC CGL FOUNDATION', name: 'SSC CGL Foundation' },
        { code: 'BANK PO CRASH', name: 'Bank PO Crash', isActive: false },
      ],
    });
    const { service } = await serviceWith({
      realPrograms: true,
      student: { programs: ['SSC CGL FOUNDATION', 'BANK PO CRASH'] },
    });

    await service.update(STUDENT, { programs: ['BANK PO CRASH'] });
    assert.deepEqual((await row()).programs, ['BANK PO CRASH']);

    await assert.rejects(
      () => service.update(STUDENT, { programs: ['BANK PO CRASH', 'NOT A PROGRAM'] }),
      refusedOn('programs'),
    );
    assert.deepEqual((await row()).programs, ['BANK PO CRASH'], 'and writes nothing');
  });

  /** The whole list was validated, so an exam since retired blocked taking any other exam off. */
  it('takes one exam off while a retired one stays held, and still refuses an unknown one added', async () => {
    const { service } = await serviceWith({ student: { enrolledExams: ['SSC CGL', 'OLD EXAM'] } });

    await service.update(STUDENT, { enrolledExams: ['OLD EXAM'] });
    assert.deepEqual((await row()).enrolledExams, ['OLD EXAM']);

    await assert.rejects(
      () => service.update(STUDENT, { enrolledExams: ['OLD EXAM', 'SSC CGI'] }),
      refusedOn('enrolledExams'),
    );
    assert.deepEqual((await row()).enrolledExams, ['OLD EXAM'], 'and writes nothing');
  });

  /** An enrolment reaches every group carrying that code, so adding one to a blocked student undoes the block. */
  it('refuses a new enrolment for a student blocked from tests, but still lets one be taken away', async () => {
    const { service } = await serviceWith({
      student: { isTestBlocked: true, enrolledExams: ['SSC CGL', 'RRB JE'] },
    });

    const error = await service
      .update(STUDENT, { enrolledExams: ['SSC CGL', 'RRB JE', 'SSC CHSL'] })
      .catch((caught: unknown) => caught);
    assert.ok(error instanceof AppException);
    assert.match(error.message, /blocked from tests/i);
    assert.deepEqual(error.fieldErrors?.enrolledExams, [error.message]);
    assert.deepEqual((await row()).enrolledExams, ['SSC CGL', 'RRB JE'], 'and writes nothing');

    await service.update(STUDENT, { enrolledExams: ['SSC CGL'] });
    assert.deepEqual((await row()).enrolledExams, ['SSC CGL']);
  });

  it('refuses an unknown exam, a missing branch and a retired one, and changes nothing', async () => {
    const { service } = await serviceWith({
      student: { enrolledExams: ['SSC CGL'] },
      branches: [{ ...PHYSICAL, isActive: false }],
    });

    await assert.rejects(
      () => service.update(STUDENT, { enrolledExams: ['SSC CGI'] }),
      refusedOn('enrolledExams'),
    );
    for (const currentBranchId of [randomUUID(), PHYSICAL.id]) {
      await assert.rejects(
        () => service.update(STUDENT, { currentBranchId }),
        refusedOn('currentBranchId'),
      );
    }
    const unchanged = await row();
    assert.deepEqual([unchanged.enrolledExams, unchanged.currentBranchId], [['SSC CGL'], null]);
  });
});

describe('StudentsService.update — the branch has to suit the type', () => {
  const branches = [PHYSICAL, ONLINE_BRANCH];

  /** The branch was once checked only when named, so a type flip left a student in a branch that disagreed. */
  it('refuses a type flip that leaves the stored branch disagreeing', async () => {
    const { service } = await serviceWith({
      branches,
      student: { studentType: STUDENT_TYPE.ONLINE, currentBranchId: ONLINE_BRANCH.id },
    });

    await assert.rejects(
      () => service.update(STUDENT, { studentType: STUDENT_TYPE.OFFLINE }),
      refusedOn('currentBranchId'),
    );
  });

  /** The form no longer sends the online branch: switching the type is enough, and the server places them. */
  it('moves a student switched to online into the online branch, and refuses while none exists', async () => {
    const { service } = await serviceWith({
      student: { studentType: STUDENT_TYPE.OFFLINE, currentBranchId: PHYSICAL.id },
    });

    await assert.rejects(
      () => service.update(STUDENT, { studentType: STUDENT_TYPE.ONLINE }),
      refusedOn('currentBranchId'),
    );
    const unchanged = await row();
    assert.deepEqual(
      [unchanged.studentType, unchanged.currentBranchId],
      [STUDENT_TYPE.OFFLINE, PHYSICAL.id],
    );

    await prisma.branch.create({ data: ONLINE_BRANCH });
    const moved = await service.update(STUDENT, { studentType: STUDENT_TYPE.ONLINE });
    assert.deepEqual(
      [moved.studentType, moved.currentBranchId],
      [STUDENT_TYPE.ONLINE, ONLINE_BRANCH.id],
    );
  });

  it('takes the type and the branch moving together', async () => {
    const { service } = await serviceWith({
      branches,
      student: { studentType: STUDENT_TYPE.OFFLINE, currentBranchId: PHYSICAL.id },
    });

    const updated = await service.update(STUDENT, {
      studentType: STUDENT_TYPE.ONLINE,
      currentBranchId: ONLINE_BRANCH.id,
    });

    assert.equal(updated.currentBranchId, ONLINE_BRANCH.id);
  });

  it('refuses a switch to non-IACE that keeps the branch, and a branch named for a non-IACE student', async () => {
    const { service } = await serviceWith({
      branches,
      student: { studentType: STUDENT_TYPE.OFFLINE, currentBranchId: PHYSICAL.id },
    });

    await assert.rejects(
      () => service.update(STUDENT, { studentType: STUDENT_TYPE.NON_IACE }),
      refusedOn('currentBranchId'),
    );
    await assert.rejects(
      () =>
        service.update(STUDENT, {
          studentType: STUDENT_TYPE.NON_IACE,
          currentBranchId: ONLINE_BRANCH.id,
        }),
      refusedOn('currentBranchId'),
    );
    const unchanged = await row();
    assert.deepEqual(
      [unchanged.studentType, unchanged.currentBranchId],
      [STUDENT_TYPE.OFFLINE, PHYSICAL.id],
    );
  });

  it('takes a switch to non-IACE that clears the branch in the same save', async () => {
    const { service } = await serviceWith({
      branches,
      student: { studentType: STUDENT_TYPE.OFFLINE, currentBranchId: PHYSICAL.id },
    });

    const updated = await service.update(STUDENT, {
      studentType: STUDENT_TYPE.NON_IACE,
      currentBranchId: null,
    });

    assert.deepEqual([updated.studentType, updated.currentBranchId], [STUDENT_TYPE.NON_IACE, null]);
    await assert.rejects(
      () => service.update(STUDENT, { currentBranchId: PHYSICAL.id }),
      refusedOn('currentBranchId'),
    );
  });

  /** A row stored before the rule existed must stay editable, or nobody can even correct the branch. */
  it('leaves a student already stored out of agreement editable, and puts them right once the branch is touched', async () => {
    const { service } = await serviceWith({
      branches,
      student: { studentType: STUDENT_TYPE.ONLINE, currentBranchId: PHYSICAL.id },
    });

    assert.equal(
      (await service.update(STUDENT, { fullName: 'Asha Kumari' })).fullName,
      'Asha Kumari',
    );
    assert.equal(
      (await service.update(STUDENT, { currentBranchId: null })).currentBranchId,
      ONLINE_BRANCH.id,
    );
  });
});

describe('StudentsService.setTestBlocked — separate from sign-in', () => {
  it('blocks tests without touching whether they can sign in, and lifts the block again', async () => {
    const { service } = await serviceWith();

    const detail = await service.setTestBlocked(STUDENT, true);
    assert.equal(detail.isTestBlocked, true);
    const blocked = await row();
    assert.deepEqual([blocked.isTestBlocked, blocked.isActive], [true, true]);

    await service.setTestBlocked(STUDENT, false);
    assert.equal((await row()).isTestBlocked, false);
  });

  it('refuses a student that does not exist', async () => {
    const { service } = await serviceWith(noStudentYet);

    await assert.rejects(
      () => service.setTestBlocked(randomUUID(), true),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

/** The session listener acts on this one signal alone; a grant or a block firing it too would sign out a student nobody meant to touch. */
describe('StudentsService — the deactivation signal a session listener can trust', () => {
  const deactivated = (events: FakeEventBus) => events.of(DOMAIN_EVENTS.STUDENT_DEACTIVATED);

  it('fires only when the switch turns off, not when it turns back on', async () => {
    const { service, events } = await serviceWith();

    await service.setActive(STUDENT, false);
    assert.deepEqual(deactivated(events), [{ studentId: STUDENT }]);

    events.forget();
    await service.setActive(STUDENT, true);
    assert.deepEqual(deactivated(events), []);
  });

  it('stays quiet for a test block or an enrolment change', async () => {
    for (const write of [
      (service: StudentsService) => service.setTestBlocked(STUDENT, true),
      (service: StudentsService) => service.update(STUDENT, { enrolledExams: ['SSC CGL'] }),
    ]) {
      await resetDatabase(prisma);
      const { service, events } = await serviceWith();

      await write(service);

      assert.deepEqual(deactivated(events), []);
    }
  });
});

describe('StudentsService — driven live, the diff an admin edit contributes', () => {
  const diffOf = async (context: AuditContext, edit: () => Promise<unknown>) =>
    context.run(async () => {
      await edit();
      return context.current()?.changed;
    });

  it('reports a rename with the real before and after values, and nothing for a save that changed nothing', async () => {
    const { service, auditContext } = await serviceWith({ student: { fullName: 'Asha' } });

    const renamed = await diffOf(auditContext, () =>
      service.update(STUDENT, { fullName: 'Asha Rani' }),
    );
    const unchanged = await diffOf(auditContext, () =>
      service.update(STUDENT, { fullName: 'Asha Rani' }),
    );

    assert.deepEqual(renamed, { fullName: { from: 'Asha', to: 'Asha Rani' } });
    assert.equal(unchanged, null);
  });

  /** A profile edit carries `profile: { upsert: … }`, a relation write that must never reach the diff as a column. */
  it('never lets the profile relation write reach the diff as a column', async () => {
    const { service, auditContext } = await serviceWith({ student: { fullName: 'Asha' } });
    await prisma.studentProfile.create({ data: { studentId: STUDENT } });

    const changed = await diffOf(auditContext, () =>
      service.update(STUDENT, { fullName: 'Asha Rani', profile: { motherName: 'Lakshmi' } }),
    );

    assert.deepEqual(Object.keys(changed ?? {}).sort(), ['fullName', 'motherName']);
  });

  /** The log outlives an erasure, so it says a personal field moved and never what it holds. */
  it('names each profile field that moved, and carries none of their values', async () => {
    const { service, auditContext } = await serviceWith();
    await prisma.studentProfile.create({
      data: { studentId: STUDENT, motherName: 'Lakshmi', email: 'asha@example.com' },
    });
    const profile = {
      motherName: 'Lakshmi',
      fatherName: 'Ravi',
      dob: '2004-05-01',
      email: null,
      address: '12 Tank Bund Road',
      gender: 'FEMALE' as const,
    };

    const changed = await diffOf(auditContext, () => service.update(STUDENT, { profile }));
    const again = await diffOf(auditContext, () => service.update(STUDENT, { profile }));

    assert.deepEqual(Object.keys(changed ?? {}).sort(), [
      'address',
      'dob',
      'email',
      'fatherName',
      'gender',
    ]);
    const logged = JSON.stringify(changed);
    for (const value of ['Ravi', '2004', 'asha@example.com', 'Tank Bund', 'FEMALE']) {
      assert.ok(!logged.includes(value), `${value} must not reach the audit log`);
    }
    assert.equal(again, null);
  });

  /** Re-activating an active student once filed a change from true to true — a row asserting nothing happened. */
  it('reports a deactivation and a test block, and nothing when the toggle did not move', async () => {
    const { service, auditContext } = await serviceWith();

    assert.equal(await diffOf(auditContext, () => service.setActive(STUDENT, true)), null);
    assert.deepEqual(await diffOf(auditContext, () => service.setActive(STUDENT, false)), {
      isActive: { from: true, to: false },
    });
    assert.deepEqual(await diffOf(auditContext, () => service.setTestBlocked(STUDENT, true)), {
      isTestBlocked: { from: false, to: true },
    });
    assert.equal(await diffOf(auditContext, () => service.setTestBlocked(STUDENT, true)), null);
  });
});

describe('StudentsService.sittings — the admin report picker', () => {
  /** A sitting of a test with the given title, by the student named. */
  const sat = async (
    studentId: string,
    title: string | null,
    over: { isGraded?: boolean; attemptNo?: number } = {},
  ) => {
    const test = await makeTest(prisma, await makeCatalog(prisma), { title });
    return makeSitting(prisma, { testId: test.id, studentId, score: 1, ...over });
  };

  const query = (raw: Record<string, string>) => studentSittingsQuerySchema.parse(raw);

  it('narrows to the tests whose title matches, in any case, and names whether each holds the ranked slot', async () => {
    const { service } = await serviceWith();
    const other = await makeStudent(prisma);
    const mockTest = await makeTest(prisma, await makeCatalog(prisma), { title: 'SSC CGL Mock 3' });
    const mock = await makeSitting(prisma, { testId: mockTest.id, studentId: STUDENT, score: 1 });
    const retake = await makeSitting(prisma, {
      testId: mockTest.id,
      studentId: STUDENT,
      score: 1,
      attemptNo: 2,
      isGraded: false,
    });
    await sat(STUDENT, 'Quant sectional');
    await makeSitting(prisma, { testId: mockTest.id, studentId: other.id, score: 1 });

    const page = await service.sittings(STUDENT, query({ q: 'MOCK' }));

    assert.deepEqual(
      page.items.map((item) => [item.attemptId, item.isGraded]).toSorted(),
      [
        [mock.id, true],
        [retake.id, false],
      ].toSorted(),
    );
    assert.equal(page.total, 2);
  });

  it('keeps an untitled test in the list while the search box is blank', async () => {
    const { service } = await serviceWith();
    const titled = await sat(STUDENT, 'SSC CGL Mock 3');
    const untitled = await sat(STUDENT, null);

    const page = await service.sittings(STUDENT, query({ q: '   ' }));

    assert.deepEqual(
      page.items.map((item) => item.attemptId).toSorted(),
      [titled.id, untitled.id].toSorted(),
    );
  });
});

describe('StudentsService — the seams other modules come through', () => {
  const profileOf = () => prisma.studentProfile.findUnique({ where: { studentId: STUDENT } });

  /** A stale `false` keeps nudging the student to upload something they just uploaded. */
  it('stores a document key, and the profile it completes reads as completed', async () => {
    const { service } = await serviceWith();
    await prisma.studentProfile.create({
      data: {
        studentId: STUDENT,
        motherName: 'A',
        fatherName: 'B',
        dob: new Date('2000-01-01'),
        gender: 'MALE',
        aadhaarVerified: true,
        panVerified: true,
      },
    });

    await service.saveDocumentKey(STUDENT, 'photoUrl', 'students/stu_1/photo-2.jpg');

    assert.equal((await profileOf())?.photoUrl, 'students/stu_1/photo-2.jpg');
    assert.equal((await service.detail(STUDENT)).profileCompleted, true);
  });

  it('leaves the flag false while anything is still missing, and refuses a student who is not there', async () => {
    const { service } = await serviceWith();

    await service.saveDocumentKey(STUDENT, 'photoUrl', 'students/stu_1/photo-1.jpg');

    assert.equal((await profileOf())?.photoUrl, 'students/stu_1/photo-1.jpg');
    assert.equal((await service.detail(STUDENT)).profileCompleted, false);
    await assert.rejects(
      () => service.saveDocumentKey(randomUUID(), 'photoUrl', 'k'),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });

  /** Called before the upload in MeService, so no file lands under a prefix no record points at. */
  it('passes assertExists for a real student and throws NOT_FOUND otherwise', async () => {
    const { service } = await serviceWith();

    await assert.doesNotReject(() => service.assertExists(STUDENT));
    await assert.rejects(
      () => service.assertExists(randomUUID()),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });

  /** The code is free text on the student, so `configs` has nothing to join on and asks here. */
  it('counts the students enrolled under an exam code', async () => {
    const { service } = await serviceWith({ student: { enrolledExams: ['SSC CGL'] } });
    await makeStudent(prisma, { enrolledExams: ['SSC CGL', 'RRB JE'] });
    await makeStudent(prisma, { enrolledExams: [] });

    assert.equal(await service.countEnrolledIn('SSC CGL'), 2);
    assert.equal(await service.countEnrolledIn('RRB JE'), 1);
    assert.equal(await service.countEnrolledIn('SSC CHSL'), 0);
  });
});

describe('StudentsService.changeMobile — who they sign in as', () => {
  const OLD = '9876543210';
  const NEW = '9123456780';
  const ADMIN = randomUUID();
  const searchFor = (q: string) => studentListQuerySchema.parse({ q });

  /** The failure this prevents: a number that moved, leaving nobody able to find the student by the old one. */
  it('moves the number, keeps the old one against who changed it, and asks for every session to end', async () => {
    const { service, events } = await serviceWith({ student: { mobile: OLD } });

    const detail = await service.changeMobile(STUDENT, NEW, ADMIN);

    assert.equal(detail.mobile, NEW);
    assert.deepEqual(
      detail.formerMobiles.map((former) => former.mobile),
      [OLD],
    );
    const kept = await prisma.studentMobileHistory.findFirstOrThrow({
      where: { studentId: STUDENT },
    });
    assert.deepEqual([kept.mobile, kept.changedById], [OLD, ADMIN]);
    assert.deepEqual(events.of(DOMAIN_EVENTS.STUDENT_MOBILE_CHANGED), [{ studentId: STUDENT }]);
  });

  /** Operators recycle numbers: the old one finds its former holder, and never stops a stranger taking it. */
  it('finds them in the roster by the old number, beside the stranger who signs in with it now', async () => {
    const { service } = await serviceWith({ student: { mobile: OLD } });
    await service.changeMobile(STUDENT, NEW, ADMIN);
    const stranger = await makeStudent(prisma, { mobile: OLD });

    const found = await service.list(searchFor(OLD));

    assert.deepEqual(new Set(found.items.map((item) => item.id)), new Set([STUDENT, stranger.id]));
  });

  it('lists every number they have moved off, newest first', async () => {
    const { service } = await serviceWith({ student: { mobile: OLD } });
    await service.changeMobile(STUDENT, NEW, ADMIN);

    const detail = await service.changeMobile(STUDENT, '9000000001', ADMIN);

    assert.deepEqual(
      detail.formerMobiles.map((former) => former.mobile),
      [NEW, OLD],
    );
  });

  /** The failure this prevents: the number they sign in with now, listed beside itself as a previous one. */
  it('leaves the number they hold now out of their previous ones after a change back', async () => {
    const { service } = await serviceWith({ student: { mobile: OLD } });
    await service.changeMobile(STUDENT, NEW, ADMIN);

    const detail = await service.changeMobile(STUDENT, OLD, ADMIN);

    assert.deepEqual(
      detail.formerMobiles.map((former) => former.mobile),
      [NEW],
    );
    const found = await service.list(searchFor(NEW));
    assert.deepEqual(
      found.items.map((item) => item.id),
      [STUDENT],
    );
  });

  /** The mobile field and the importer read a prefix off; a number pasted into the search box is the same number. */
  it('finds a student by their number however its prefix and spacing were pasted', async () => {
    const { service } = await serviceWith({ student: { mobile: OLD, fullName: 'Asha Rani' } });
    await makeStudent(prisma, { mobile: '9000000002', fullName: 'Bala' });
    const idsFor = async (q: string) =>
      (await service.list(searchFor(q))).items.map((item) => item.id);

    for (const pasted of [`+91${OLD}`, `+91 ${OLD}`, `91${OLD}`, `0${OLD}`, '98765 43210']) {
      assert.deepEqual(await idsFor(pasted), [STUDENT], pasted);
    }
    assert.deepEqual(await idsFor('asha 98765'), [STUDENT], 'a name and part of a number');
    assert.deepEqual(await idsFor('6543'), [STUDENT], 'part of a number');

    await service.changeMobile(STUDENT, NEW, ADMIN);
    assert.deepEqual(await idsFor(`+91 ${OLD}`), [STUDENT], 'a previous number, with its prefix');
  });

  it('refuses a number a live student signs in with, and their own, and moves nothing', async () => {
    const { service, events } = await serviceWith({ student: { mobile: OLD } });
    await makeStudent(prisma, { mobile: NEW });

    await assert.rejects(
      () => service.changeMobile(STUDENT, NEW, ADMIN),
      refusedOn('mobile', ErrorCodes.CONFLICT),
    );
    await assert.rejects(
      () => service.changeMobile(STUDENT, OLD, ADMIN),
      refusedOn('mobile', ErrorCodes.CONFLICT),
    );

    assert.equal((await row()).mobile, OLD);
    assert.equal(await prisma.studentMobileHistory.count(), 0);
    assert.deepEqual(events.of(DOMAIN_EVENTS.STUDENT_MOBILE_CHANGED), []);
  });

  /** The failure this prevents: an erasure landing mid-change, and a real number written back onto the erased row. */
  it('moves nothing when the student was erased while the change was being made', async () => {
    let erased = false;
    const eraseOnce = async () => {
      if (erased) return;
      erased = true;
      await prisma.student.update({ where: { id: STUDENT }, data: { deletedAt: new Date() } });
    };
    const { service } = await serviceWith({
      student: { mobile: OLD },
      client: afterEachStudentRead(eraseOnce),
    });

    await assert.rejects(
      () => service.changeMobile(STUDENT, NEW, ADMIN),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT,
    );

    assert.equal((await row()).mobile, OLD);
    assert.equal(await prisma.studentMobileHistory.count(), 0);
  });

  /** An erased row carries a tombstone, not a number: moving it would hand a closed account to somebody. */
  it('refuses a student who has been erased', async () => {
    const { service } = await serviceWith({ student: { mobile: OLD, deletedAt: new Date() } });

    await assert.rejects(
      () => service.changeMobile(STUDENT, NEW, ADMIN),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
    assert.equal((await row()).mobile, OLD);
  });
});
