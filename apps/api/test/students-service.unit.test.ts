import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes, STUDENT_TYPE } from '@iace/contracts';
import { StudentsService } from '../src/students/students.service';
import { BranchesService } from '../src/branches/branches.service';
import { type ExamTypesService } from '../src/configs';
import { type StorageService } from '../src/storage/storage.service';
import { AuditContext } from '../src/audit';
import { FakePrisma, makeBranch, makeStudent } from './support/fakes';

/**
 * `enrolledExams` is free text with no foreign key, so nothing but this service stops a typo
 * becoming an enrolment that resolves to no group at all. Its refusal is asserted here.
 */
class FakeExamTypes {
  readonly calls: { codes: string[]; fieldKey: string }[] = [];

  constructor(private readonly usable: string[] = []) {}

  assertUsable(codes: string[], fieldKey: string): Promise<void> {
    this.calls.push({ codes, fieldKey });
    const unknown = codes.filter((code) => !this.usable.includes(code));
    if (unknown.length > 0) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'No such exam type', {
        fieldErrors: { [fieldKey]: ['No such exam type'] },
      });
    }
    return Promise.resolve();
  }

  asService(): ExamTypesService {
    return this as unknown as ExamTypesService;
  }
}

function serviceWith(
  students = [makeStudent()],
  usableExams = ['SSC CGL', 'RRB JE'],
  branches = [makeBranch({ id: 'br_1' })],
) {
  const prisma = new FakePrisma(students, [], branches);
  const examTypes = new FakeExamTypes(usableExams);
  return {
    prisma,
    examTypes,
    service: new StudentsService(
      prisma.asService(),
      undefined as unknown as StorageService,
      examTypes.asService(),
      new BranchesService(prisma.asService()),
      new AuditContext(),
    ),
  };
}

describe('StudentsService.create — the type is the caller’s, never the service’s', () => {
  it('stores the type the request asked for', async () => {
    const { service, prisma } = serviceWith([]);

    await service.create({ mobile: '9000000001', studentType: STUDENT_TYPE.OFFLINE });

    assert.equal(prisma.students[0]?.studentType, STUDENT_TYPE.OFFLINE);
  });

  it('stores the enrolments, the programme and the branch', async () => {
    const { service, prisma } = serviceWith([]);

    await service.create({
      mobile: '9000000002',
      studentType: STUDENT_TYPE.OFFLINE,
      enrolledExams: ['SSC CGL'],
      program: 'One year classroom',
      currentBranchId: 'br_1',
    });

    assert.deepEqual(prisma.students[0]?.enrolledExams, ['SSC CGL']);
    assert.equal(prisma.students[0]?.program, 'One year classroom');
    assert.equal(prisma.students[0]?.currentBranchId, 'br_1');
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

describe('StudentsService.update — the access fields', () => {
  it('replaces the enrolments and validates them first', async () => {
    const { service, prisma, examTypes } = serviceWith([
      makeStudent({ id: 'stu_1', enrolledExams: ['SSC CGL'] }),
    ]);

    await service.update('stu_1', { enrolledExams: ['RRB JE'] });

    assert.deepEqual(prisma.students[0]?.enrolledExams, ['RRB JE']);
    assert.deepEqual(examTypes.calls.at(-1), { codes: ['RRB JE'], fieldKey: 'enrolledExams' });
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

  it('clears the programme and the branch when the patch says null', async () => {
    const { service, prisma } = serviceWith([
      makeStudent({ id: 'stu_1', program: 'One year classroom', currentBranchId: 'br_1' }),
    ]);

    await service.update('stu_1', { program: null, currentBranchId: null });

    assert.equal(prisma.students[0]?.program, null);
    assert.equal(prisma.students[0]?.currentBranchId, null);
  });

  it('leaves the access fields alone when the patch omits them', async () => {
    const { service, prisma } = serviceWith([
      makeStudent({ id: 'stu_1', enrolledExams: ['SSC CGL'], program: 'One year classroom' }),
    ]);

    await service.update('stu_1', { fullName: 'Ravi Kumar' });

    assert.deepEqual(prisma.students[0]?.enrolledExams, ['SSC CGL']);
    assert.equal(prisma.students[0]?.program, 'One year classroom');
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
