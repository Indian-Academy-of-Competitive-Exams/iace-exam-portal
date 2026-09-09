import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, BRANCH_TYPE, ErrorCodes, EXAM_COURSE, STUDENT_TYPE } from '@iace/contracts';
import { MESSAGE_KINDS } from '../src/common/messaging';
import { StudentsService } from '../src/students/students.service';
import { BranchesService } from '../src/branches/branches.service';
import { type ExamsService } from '../src/configs';
import { type StorageService } from '../src/storage/storage.service';
import { AuditContext } from '../src/audit';
import { DOMAIN_EVENTS } from '../src/common/events';
import {
  fakeStartingPins,
  FakeCodeCatalog,
  FakeMessageSender,
  FakeEventBus,
  FakePrisma,
  makeBranch,
  makeStudent,
  fakeNotificationOutbox,
} from './support/fakes';

/**
 * `enrolledExams` is free text with no foreign key, so nothing but this service stops a typo
 * becoming an enrolment that resolves to no group at all. Its refusal is asserted here.
 */
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

function serviceWith(
  students = [makeStudent()],
  usableExams = ['SSC CGL', 'RRB JE'],
  branches = [makeBranch({ id: 'br_1' })],
  usablePrograms = ['SSC CGL FOUNDATION'],
) {
  const prisma = new FakePrisma(students, [], branches);
  const exams = new FakeExams(usableExams);
  const programs = new FakeCodeCatalog(usablePrograms);
  const events = new FakeEventBus();
  const sender = new FakeMessageSender();
  return {
    prisma,
    exams,
    programs,
    events,
    sender,
    service: new StudentsService(
      prisma.asService(),
      undefined as unknown as StorageService,
      exams.asService(),
      new BranchesService(prisma.asService(), new AuditContext()),
      fakeStartingPins(sender),
      programs.asService(),
      new AuditContext(),
      events.asService(),
      fakeNotificationOutbox(),
    ),
  };
}

describe('StudentsService.enrolmentOf — what a student reads on their own profile', () => {
  it('resolves every code the student carries to the catalog name for it', async () => {
    const { service } = serviceWith([
      makeStudent({
        enrolledExams: ['SSC CGL'],
        programs: ['SSC CGL FOUNDATION'],
        currentBranchId: 'br_1',
      }),
    ]);

    const enrolment = await service.enrolmentOf({
      enrolledExams: ['SSC CGL'],
      programs: ['SSC CGL FOUNDATION'],
      currentBranchId: 'br_1',
    });

    assert.deepEqual(enrolment.exams, [{ code: 'SSC CGL', name: 'SSC CGL name' }]);
    assert.deepEqual(enrolment.programs, [
      { code: 'SSC CGL FOUNDATION', name: 'SSC CGL FOUNDATION name' },
    ]);
    assert.equal(enrolment.branch, makeBranch({ id: 'br_1' }).name);
  });

  /** The failure this prevents: a catalog row deleted under the student blanking their own row. */
  it('falls back to the code itself when the catalog no longer holds it', async () => {
    const { service } = serviceWith();

    const enrolment = await service.enrolmentOf({
      enrolledExams: ['SSC CHSL'],
      programs: [],
      currentBranchId: null,
    });

    assert.deepEqual(enrolment.exams, [{ code: 'SSC CHSL', name: 'SSC CHSL' }]);
    assert.equal(enrolment.branch, null);
  });
});

const PHYSICAL = makeBranch({ id: 'br_1', name: 'AMEERPET' });
const ONLINE_BRANCH = makeBranch({ id: 'br_online', name: 'ONLINE', type: BRANCH_TYPE.VIRTUAL });

describe('StudentsService.create — the type is the caller’s, never the service’s', () => {
  it('stores the type the request asked for', async () => {
    const { service, prisma } = serviceWith([]);

    await service.create({ mobile: '9000000001', studentType: STUDENT_TYPE.OFFLINE });

    assert.equal(prisma.students[0]?.studentType, STUDENT_TYPE.OFFLINE);
  });

  /** No pinHash meant loginStudent read the null as a wrong PIN, forever. */
  it('gives the student a starting PIN, so they can sign in the day they are added', async () => {
    const { service, prisma } = serviceWith([]);

    await service.create({ mobile: '9000000020', studentType: STUDENT_TYPE.ONLINE });

    assert.match(prisma.students[0]?.pinHash ?? '', /^hash:\d{4}$/);
    assert.equal(prisma.students[0]?.pinIsDefault, true);
  });

  /** A roster in the wrong hands used to BE the list of PINs: each one was the mobile it belonged to. */
  it('does not derive that PIN from the number it belongs to', async () => {
    const { service, prisma } = serviceWith([]);

    await service.create({ mobile: '9000000020', studentType: STUDENT_TYPE.ONLINE });

    const pin = (prisma.students[0]?.pinHash ?? '').replace('hash:', '');
    assert.ok(!'9000000020'.startsWith(pin), `${pin} is the first digits of their own number`);
  });

  /** Nobody can derive it any more, so a PIN nobody was told is an account nobody can open. */
  it('texts that PIN to the student it was issued to', async () => {
    const { service, prisma, sender } = serviceWith([]);

    await service.create({ mobile: '9000000020', studentType: STUDENT_TYPE.ONLINE });

    assert.equal(sender.lastMessage.kind, MESSAGE_KINDS.PIN);
    assert.equal(sender.lastMessage.to, '9000000020');
    assert.equal(
      `hash:${String(sender.lastMessage.data?.pin)}`,
      prisma.students[0]?.pinHash,
      'the PIN they were told has to be the one that was stored',
    );
  });

  /** The PIN is the institute's, not theirs, so the roster must still chase them to change it. */
  it('reports them as never signed in, and as still on the default PIN', async () => {
    const { service } = serviceWith([]);

    const created = await service.create({
      mobile: '9000000021',
      studentType: STUDENT_TYPE.ONLINE,
    });

    assert.equal(created.hasSignedIn, false);
    assert.equal(created.hasDefaultPin, true);
  });

  it('stores the enrolments, the programme and the branch', async () => {
    const { service, prisma } = serviceWith([]);

    await service.create({
      mobile: '9000000002',
      studentType: STUDENT_TYPE.OFFLINE,
      enrolledExams: ['SSC CGL'],
      programs: ['SSC CGL FOUNDATION'],
      currentBranchId: 'br_1',
    });

    assert.deepEqual(prisma.students[0]?.enrolledExams, ['SSC CGL']);
    assert.deepEqual(prisma.students[0]?.programs, ['SSC CGL FOUNDATION']);
    assert.equal(prisma.students[0]?.currentBranchId, 'br_1');
  });

  /**
   * The failure this prevents: `AccessResolver.resolve` reads the branch ALONE to decide what a
   * student can reach, so an online student parked at a centre silently inherits that centre's
   * schedule and window. The admin screen locks the picker; this is what makes the lock real.
   */
  it('refuses an online student put at a physical centre, under the form’s own field name', async () => {
    const { service } = serviceWith([], undefined, [PHYSICAL, ONLINE_BRANCH]);

    await assert.rejects(
      () =>
        service.create({
          mobile: '9000000010',
          studentType: STUDENT_TYPE.ONLINE,
          currentBranchId: PHYSICAL.id,
        }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
        assert.ok(error.fieldErrors?.currentBranchId);
        return true;
      },
    );
  });

  it('takes an online student in the online branch', async () => {
    const { service, prisma } = serviceWith([], undefined, [PHYSICAL, ONLINE_BRANCH]);

    await service.create({
      mobile: '9000000011',
      studentType: STUDENT_TYPE.ONLINE,
      currentBranchId: ONLINE_BRANCH.id,
    });

    assert.equal(prisma.students[0]?.currentBranchId, ONLINE_BRANCH.id);
  });

  it('refuses an offline student put in the online branch', async () => {
    const { service } = serviceWith([], undefined, [PHYSICAL, ONLINE_BRANCH]);

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

  /** They sit outside the institute, so neither branch is the wrong answer for them. */
  it('lets a non-IACE student sit in either kind of branch', async () => {
    const { service, prisma } = serviceWith([], undefined, [PHYSICAL, ONLINE_BRANCH]);

    await service.create({
      mobile: '9000000013',
      studentType: STUDENT_TYPE.NON_IACE,
      currentBranchId: ONLINE_BRANCH.id,
    });

    assert.equal(prisma.students[0]?.currentBranchId, ONLINE_BRANCH.id);
  });

  /**
   * The failure this exists to prevent: an exam code nothing in the catalog matches is stored, the
   * student resolves to no EXAM group, and the screen reports a successful enrolment.
   */
  it('refuses an exam code the catalog does not hold, under the form’s own field name', async () => {
    const { service, prisma } = serviceWith([]);

    const error = await service
      .create({
        mobile: '9000000003',
        studentType: STUDENT_TYPE.ONLINE,
        enrolledExams: ['SSC CGI'],
      })
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    assert.ok(error instanceof AppException);
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.enrolledExams, 'the key must be the one the student form owns');
    assert.equal(prisma.students.length, 0, 'nothing was written');
  });

  /**
   * `BranchesService.assertUsable` hardcoded `fieldErrors.branchId` before this task — a form whose
   * field is `currentBranchId` would have had its refusal silently dropped by `applyFieldErrors`.
   */
  it('refuses a branch that does not exist, under the form’s own field name', async () => {
    const { service, prisma } = serviceWith([], undefined, []);

    const error = await service
      .create({
        mobile: '9000000004',
        studentType: STUDENT_TYPE.ONLINE,
        currentBranchId: 'br_missing',
      })
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    assert.ok(error instanceof AppException);
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.currentBranchId, 'the key must be the one the student form owns');
    assert.equal(prisma.students.length, 0, 'nothing was written');
  });

  it('refuses a retired branch, under the form’s own field name', async () => {
    const { service, prisma } = serviceWith([], undefined, [
      makeBranch({ id: 'br_1', isActive: false }),
    ]);

    const error = await service
      .create({ mobile: '9000000005', studentType: STUDENT_TYPE.ONLINE, currentBranchId: 'br_1' })
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    assert.ok(error instanceof AppException);
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.currentBranchId, 'the key must be the one the student form owns');
    assert.equal(prisma.students.length, 0, 'nothing was written');
  });
});

describe('StudentsService — a whole exam course', () => {
  /** A course is coarser than an enrolment; the resolver reads both, so both must be writable. */
  it('stores the courses a student is coached across', async () => {
    const { service, prisma } = serviceWith([]);

    await service.create({
      mobile: '9000000010',
      studentType: STUDENT_TYPE.ONLINE,
      enrolledCourses: [EXAM_COURSE.SSC],
    });

    assert.deepEqual(prisma.students[0]?.enrolledCourses, [EXAM_COURSE.SSC]);
  });

  it('replaces them wholesale, down to none', async () => {
    const { service, prisma } = serviceWith([
      makeStudent({ id: 'stu_1', enrolledCourses: [EXAM_COURSE.SSC, EXAM_COURSE.RRB] }),
    ]);

    await service.update('stu_1', { enrolledCourses: [EXAM_COURSE.RRB] });

    assert.deepEqual(prisma.students[0]?.enrolledCourses, [EXAM_COURSE.RRB]);
  });

  it('leaves them alone when the patch omits them', async () => {
    const { service, prisma } = serviceWith([
      makeStudent({ id: 'stu_1', enrolledCourses: [EXAM_COURSE.SSC] }),
    ]);

    await service.update('stu_1', { fullName: 'Ravi Kumar' });

    assert.deepEqual(prisma.students[0]?.enrolledCourses, [EXAM_COURSE.SSC]);
  });
});

describe('StudentsService — the program tag', () => {
  /**
   * `Student.programs` holds a code with no foreign key behind it, so a typo becomes a program
   * nothing matches — and a student who quietly reaches no series at all.
   */
  it('refuses a program the catalog does not hold, under the form’s own field name', async () => {
    const { service } = serviceWith([]);

    const error = await service
      .create({
        mobile: '9000000009',
        studentType: STUDENT_TYPE.ONLINE,
        programs: ['NOT A PROGRAM'],
      })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.programs);
  });

  it('validates the programs a patch names, not the ones already stored', async () => {
    const { service, programs } = serviceWith([
      makeStudent({ id: 'stu_1', programs: ['SSC CGL FOUNDATION'] }),
    ]);

    await service.update('stu_1', { fullName: 'Ravi Kumar' });

    assert.deepEqual(programs.calls, [], 'an untouched list is not re-checked');
  });

  it('lets every program be taken away', async () => {
    const { service, prisma } = serviceWith([
      makeStudent({ id: 'stu_1', programs: ['SSC CGL FOUNDATION'] }),
    ]);

    await service.update('stu_1', { programs: [] });

    assert.deepEqual(prisma.students[0]?.programs, []);
  });
});

describe('StudentsService.update — the access fields', () => {
  it('replaces the enrolments and validates them first', async () => {
    const { service, prisma, exams } = serviceWith([
      makeStudent({ id: 'stu_1', enrolledExams: ['SSC CGL'] }),
    ]);

    await service.update('stu_1', { enrolledExams: ['RRB JE'] });

    assert.deepEqual(prisma.students[0]?.enrolledExams, ['RRB JE']);
    assert.deepEqual(exams.calls.at(-1), { codes: ['RRB JE'], fieldKey: 'enrolledExams' });
  });

  it('lets every enrolment be taken away', async () => {
    const { service, prisma } = serviceWith([
      makeStudent({ id: 'stu_1', enrolledExams: ['SSC CGL'] }),
    ]);

    await service.update('stu_1', { enrolledExams: [] });

    assert.deepEqual(prisma.students[0]?.enrolledExams, []);
  });

  /**
   * The failure this prevents: an enrolment reaches every EXAM and PROGRAM group carrying that
   * code, so adding one to a blocked student hands back what the block took away.
   */
  it('refuses a new enrolment for a student blocked from tests', async () => {
    const { service, prisma } = serviceWith([
      makeStudent({ id: 'stu_1', isTestBlocked: true, enrolledExams: ['SSC CGL'] }),
    ]);

    const error = await service.update('stu_1', { enrolledExams: ['SSC CGL', 'RRB JE'] }).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    assert.ok(error instanceof AppException);
    assert.match(error.message, /blocked from tests/i);
    assert.deepEqual(error.fieldErrors?.enrolledExams, [error.message]);
    assert.deepEqual(prisma.students[0]?.enrolledExams, ['SSC CGL'], 'and writes nothing');
  });

  it('still lets a blocked student be un-enrolled — the block takes access, never gives it', async () => {
    const { service, prisma } = serviceWith([
      makeStudent({ id: 'stu_1', isTestBlocked: true, enrolledExams: ['SSC CGL', 'RRB JE'] }),
    ]);

    await service.update('stu_1', { enrolledExams: ['SSC CGL'] });

    assert.deepEqual(prisma.students[0]?.enrolledExams, ['SSC CGL']);
  });

  it('clears the programs and the branch when the patch says so', async () => {
    const { service, prisma } = serviceWith([
      makeStudent({ id: 'stu_1', programs: ['SSC CGL FOUNDATION'], currentBranchId: 'br_1' }),
    ]);

    await service.update('stu_1', { programs: [], currentBranchId: null });

    assert.deepEqual(prisma.students[0]?.programs, []);
    assert.equal(prisma.students[0]?.currentBranchId, null);
  });

  it('leaves the access fields alone when the patch omits them', async () => {
    const { service, prisma } = serviceWith([
      makeStudent({ id: 'stu_1', enrolledExams: ['SSC CGL'], programs: ['SSC CGL FOUNDATION'] }),
    ]);

    await service.update('stu_1', { fullName: 'Ravi Kumar' });

    assert.deepEqual(prisma.students[0]?.enrolledExams, ['SSC CGL']);
    assert.deepEqual(prisma.students[0]?.programs, ['SSC CGL FOUNDATION']);
  });

  it('refuses an exam code the catalog does not hold, under the form’s own field name', async () => {
    const { service, prisma } = serviceWith([
      makeStudent({ id: 'stu_1', enrolledExams: ['SSC CGL'] }),
    ]);

    const error = await service.update('stu_1', { enrolledExams: ['SSC CGI'] }).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    assert.ok(error instanceof AppException);
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.enrolledExams, 'the key must be the one the student form owns');
    assert.deepEqual(prisma.students[0]?.enrolledExams, ['SSC CGL'], 'nothing changed');
  });

  it('refuses a branch that does not exist, under the form’s own field name', async () => {
    const { service, prisma } = serviceWith([makeStudent({ id: 'stu_1' })], undefined, []);

    const error = await service.update('stu_1', { currentBranchId: 'br_missing' }).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    assert.ok(error instanceof AppException);
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.currentBranchId, 'the key must be the one the student form owns');
    assert.equal(prisma.students[0]?.currentBranchId, null, 'nothing changed');
  });

  it('refuses a retired branch, under the form’s own field name', async () => {
    const { service, prisma } = serviceWith([makeStudent({ id: 'stu_1' })], undefined, [
      makeBranch({ id: 'br_1', isActive: false }),
    ]);

    const error = await service.update('stu_1', { currentBranchId: 'br_1' }).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    assert.ok(error instanceof AppException);
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.currentBranchId, 'the key must be the one the student form owns');
    assert.equal(prisma.students[0]?.currentBranchId, null, 'nothing changed');
  });
});

describe('StudentsService.update — the branch has to suit the type', () => {
  /**
   * The failure this prevents: the branch was checked only when the request NAMED one, so flipping
   * an offline student to online left them sitting at their old centre — the exact state the create
   * form refuses, reached by a different door.
   */
  it('refuses a type flip that leaves the stored branch disagreeing', async () => {
    const student = makeStudent({
      studentType: STUDENT_TYPE.OFFLINE,
      currentBranchId: PHYSICAL.id,
    });
    const { service } = serviceWith([student], undefined, [PHYSICAL, ONLINE_BRANCH]);

    await assert.rejects(
      () => service.update(student.id, { studentType: STUDENT_TYPE.ONLINE }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
        assert.ok(error.fieldErrors?.currentBranchId);
        return true;
      },
    );
  });

  it('takes the type and the branch moving together', async () => {
    const student = makeStudent({
      studentType: STUDENT_TYPE.OFFLINE,
      currentBranchId: PHYSICAL.id,
    });
    const { service } = serviceWith([student], undefined, [PHYSICAL, ONLINE_BRANCH]);

    const updated = await service.update(student.id, {
      studentType: STUDENT_TYPE.ONLINE,
      currentBranchId: ONLINE_BRANCH.id,
    });

    assert.equal(updated.currentBranchId, ONLINE_BRANCH.id);
  });

  /**
   * A row stored before the rule existed must stay editable — otherwise every unrelated save on it
   * fails and nobody can even correct the branch.
   */
  it('leaves a student already stored out of agreement editable', async () => {
    const student = makeStudent({
      studentType: STUDENT_TYPE.ONLINE,
      currentBranchId: PHYSICAL.id,
    });
    const { service } = serviceWith([student], undefined, [PHYSICAL, ONLINE_BRANCH]);

    const updated = await service.update(student.id, { fullName: 'Asha Kumari' });

    assert.equal(updated.fullName, 'Asha Kumari');
  });

  it('still lets the branch be cleared outright', async () => {
    const student = makeStudent({
      studentType: STUDENT_TYPE.ONLINE,
      currentBranchId: PHYSICAL.id,
    });
    const { service } = serviceWith([student], undefined, [PHYSICAL, ONLINE_BRANCH]);

    const updated = await service.update(student.id, { currentBranchId: null });

    assert.equal(updated.currentBranchId, null);
  });
});

describe('StudentsService.setTestBlocked — separate from sign-in', () => {
  it('blocks tests without touching whether they can sign in', async () => {
    const { service, prisma } = serviceWith([makeStudent({ id: 'stu_1' })]);

    const detail = await service.setTestBlocked('stu_1', true);

    assert.equal(detail.isTestBlocked, true);
    assert.equal(prisma.students[0]?.isTestBlocked, true);
    assert.equal(prisma.students[0]?.isActive, true, 'sign-in is a different switch');
  });

  it('lifts the block again', async () => {
    const { service, prisma } = serviceWith([makeStudent({ id: 'stu_1', isTestBlocked: true })]);

    await service.setTestBlocked('stu_1', false);

    assert.equal(prisma.students[0]?.isTestBlocked, false);
  });

  it('refuses a student that does not exist', async () => {
    const { service } = serviceWith([]);

    const error = await service.setTestBlocked('stu_missing', true).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    assert.ok(error instanceof AppException);
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });
});

/**
 * A student's catalog is cached against these four columns plus the two switches. A write that
 * moves one and stays silent leaves them on the old answer until the entry expires.
 */
describe('the student writes that bust the catalog cache', () => {
  const changed = (events: FakeEventBus) => events.of(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED);

  it('announces a test block', async () => {
    const { service, events } = serviceWith([makeStudent({ id: 'stu_1' })]);

    await service.setTestBlocked('stu_1', true);

    assert.deepEqual(changed(events), [{ studentId: 'stu_1' }]);
  });

  it('announces a deactivation', async () => {
    const { service, events } = serviceWith([makeStudent({ id: 'stu_1' })]);

    await service.setActive('stu_1', false);

    assert.deepEqual(changed(events), [{ studentId: 'stu_1' }]);
  });

  it('announces an enrolment change', async () => {
    const { service, events } = serviceWith([makeStudent({ id: 'stu_1', enrolledExams: [] })]);

    await service.update('stu_1', { enrolledExams: ['SSC CGL'] });

    assert.deepEqual(changed(events), [{ studentId: 'stu_1' }]);
  });

  /** Every profile edit busting every catalog is a stampede for a change access cannot see. */
  it('stays quiet for a patch that moves no access column', async () => {
    const { service, events } = serviceWith([
      makeStudent({ id: 'stu_1', enrolledExams: ['SSC CGL'] }),
    ]);

    await service.update('stu_1', { fullName: 'Ravi Kumar' });

    assert.deepEqual(changed(events), []);
  });
});

/** What the student is TOLD about an enrolment, which is a different fact from the cache bust. */
describe('the enrolment a student is told about', () => {
  const added = (events: FakeEventBus) => events.of(DOMAIN_EVENTS.STUDENT_ENROLMENT_ADDED);

  /**
   * THE failure this prevents: announcing the whole array turns one added exam into "you were
   * enrolled in everything you already had", every time anybody edits the record.
   */
  it('names only the codes this save added', async () => {
    const { service, events } = serviceWith([
      makeStudent({ id: 'stu_1', enrolledExams: ['SSC CGL'] }),
    ]);

    await service.update('stu_1', { enrolledExams: ['SSC CGL', 'RRB JE'] });

    assert.deepEqual(added(events), [{ studentId: 'stu_1', examCodes: ['RRB JE'] }]);
  });

  it('says nothing when an exam is taken away', async () => {
    const { service, events } = serviceWith([
      makeStudent({ id: 'stu_1', enrolledExams: ['SSC CGL', 'RRB JE'] }),
    ]);

    await service.update('stu_1', { enrolledExams: ['SSC CGL'] });

    assert.deepEqual(added(events), []);
    assert.deepEqual(
      events.of(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED),
      [{ studentId: 'stu_1' }],
      'the cache still has to forget',
    );
  });
});
