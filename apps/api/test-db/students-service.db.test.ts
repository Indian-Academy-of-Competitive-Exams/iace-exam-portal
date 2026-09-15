import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AppException,
  BRANCH_TYPE,
  EXAM_COURSE,
  ErrorCodes,
  STUDENT_TYPE,
  studentSittingsQuerySchema,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { BranchesService } from '../src/branches/branches.service';
import { DOMAIN_EVENTS } from '../src/common/events';
import { MESSAGE_KINDS } from '../src/common/messaging';
import { type ExamsService } from '../src/configs';
import { type StorageService } from '../src/storage/storage.service';
import { StudentsService } from '../src/students/students.service';
import {
  FakeCodeCatalog,
  FakeEventBus,
  FakeMessageSender,
  FakeQueue,
  fakeStartingPins,
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

const STUDENT = 'stu_1';

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

const PHYSICAL = { id: 'br_1', name: 'AMEERPET', type: BRANCH_TYPE.PHYSICAL };
const ONLINE_BRANCH = { id: 'br_online', name: 'ONLINE', type: BRANCH_TYPE.VIRTUAL };

interface Bench {
  /** The student, `stu_1`, unless the case is about creating one. */
  student?: StudentOverrides | null;
  branches?: { id: string; name: string; type: string; isActive?: boolean }[];
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
  return {
    exams,
    programs,
    events,
    sender,
    auditContext,
    service: new StudentsService(
      prisma,
      undefined as unknown as StorageService,
      exams.asService(),
      new BranchesService(prisma, new AuditContext()),
      fakeStartingPins(sender),
      programs.asService(),
      auditContext,
      events.asService(),
      new NotificationOutbox(new FakeQueue().asQueue()),
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

  /** No pinHash meant loginStudent read the null as a wrong PIN, forever; and a PIN nobody was told opens nothing. */
  it('gives the student a starting PIN not derived from their number, and texts it to them', async () => {
    const { service, sender } = await serviceWith(noStudentYet);

    const created = await service.create({
      mobile: '9000000020',
      studentType: STUDENT_TYPE.ONLINE,
    });

    const stored = await onlyStudent();
    assert.match(stored.pinHash ?? '', /^hash:\d{4}$/);
    assert.equal(stored.pinIsDefault, true);
    const pin = (stored.pinHash ?? '').replace('hash:', '');
    assert.ok(!'9000000020'.startsWith(pin), `${pin} is the first digits of their own number`);
    assert.equal(sender.lastMessage.kind, MESSAGE_KINDS.PIN);
    assert.equal(sender.lastMessage.to, '9000000020');
    assert.equal(`hash:${String(sender.lastMessage.data?.pin)}`, stored.pinHash);
    // The PIN is the institute's, not theirs, so the roster must still chase them to change it.
    assert.equal(created.hasSignedIn, false);
    assert.equal(created.hasDefaultPin, true);
  });

  /** An online student parked at a centre would silently inherit that centre's schedule and window. */
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

  /** A non-IACE student sits outside the institute, so neither kind of branch is the wrong answer. */
  it('takes an online student in the online branch, and a non-IACE one in either', async () => {
    const { service } = await serviceWith({ ...noStudentYet, branches: [PHYSICAL, ONLINE_BRANCH] });

    await service.create({
      mobile: '9000000011',
      studentType: STUDENT_TYPE.ONLINE,
      currentBranchId: ONLINE_BRANCH.id,
    });
    await service.create({
      mobile: '9000000013',
      studentType: STUDENT_TYPE.NON_IACE,
      currentBranchId: ONLINE_BRANCH.id,
    });

    assert.equal(await prisma.student.count({ where: { currentBranchId: ONLINE_BRANCH.id } }), 2);
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
    for (const currentBranchId of ['br_missing', PHYSICAL.id]) {
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
    for (const currentBranchId of ['br_missing', PHYSICAL.id]) {
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

  /** The branch was once checked only when named, so a type flip left an online student at their old centre. */
  it('refuses a type flip that leaves the stored branch disagreeing', async () => {
    const { service } = await serviceWith({
      branches,
      student: { studentType: STUDENT_TYPE.OFFLINE, currentBranchId: PHYSICAL.id },
    });

    await assert.rejects(
      () => service.update(STUDENT, { studentType: STUDENT_TYPE.ONLINE }),
      refusedOn('currentBranchId'),
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

  /** A row stored before the rule existed must stay editable, or nobody can even correct the branch. */
  it('leaves a student already stored out of agreement editable, and lets the branch be cleared', async () => {
    const { service } = await serviceWith({
      branches,
      student: { studentType: STUDENT_TYPE.ONLINE, currentBranchId: PHYSICAL.id },
    });

    assert.equal(
      (await service.update(STUDENT, { fullName: 'Asha Kumari' })).fullName,
      'Asha Kumari',
    );
    assert.equal((await service.update(STUDENT, { currentBranchId: null })).currentBranchId, null);
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
      () => service.setTestBlocked('stu_missing', true),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

/** A student's catalog is cached against their access columns and switches; a silent write leaves it stale. */
describe('the student writes that bust the catalog cache', () => {
  const changed = (events: FakeEventBus) => events.of(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED);

  it('announces a test block, a deactivation and an enrolment change', async () => {
    for (const write of [
      (service: StudentsService) => service.setTestBlocked(STUDENT, true),
      (service: StudentsService) => service.setActive(STUDENT, false),
      (service: StudentsService) => service.update(STUDENT, { enrolledExams: ['SSC CGL'] }),
    ]) {
      await resetDatabase(prisma);
      const { service, events } = await serviceWith();

      await write(service);

      assert.deepEqual(changed(events), [{ studentId: STUDENT }]);
    }
  });

  /** Every profile edit busting every catalog is a stampede for a change access cannot see. */
  it('stays quiet for a patch that moves no access column', async () => {
    const { service, events } = await serviceWith({ student: { enrolledExams: ['SSC CGL'] } });

    await service.update(STUDENT, { fullName: 'Ravi Kumar' });

    assert.deepEqual(changed(events), []);
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

    assert.deepEqual(changed, { fullName: { from: 'Asha', to: 'Asha Rani' } });
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
  it('stores a document key and recomputes profileCompleted from the merged profile', async () => {
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
    assert.equal((await row()).profileCompleted, true);
  });

  it('leaves the flag false while anything is still missing, and refuses a student who is not there', async () => {
    const { service } = await serviceWith();

    await service.saveDocumentKey(STUDENT, 'photoUrl', 'students/stu_1/photo-1.jpg');

    assert.equal((await profileOf())?.photoUrl, 'students/stu_1/photo-1.jpg');
    assert.equal((await row()).profileCompleted, false);
    await assert.rejects(
      () => service.saveDocumentKey('stu_gone', 'photoUrl', 'k'),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });

  /** Called before the upload in MeService, so no file lands under a prefix no record points at. */
  it('passes assertExists for a real student and throws NOT_FOUND otherwise', async () => {
    const { service } = await serviceWith();

    await assert.doesNotReject(() => service.assertExists(STUDENT));
    await assert.rejects(
      () => service.assertExists('stu_gone'),
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
