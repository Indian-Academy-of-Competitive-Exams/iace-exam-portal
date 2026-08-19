import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes, GROUP_TYPE, STUDENT_TYPE } from '@iace/contracts';
import { GroupsService } from '../src/groups/groups.service';
import { StudentsService } from '../src/students/students.service';
import { type BranchesService } from '../src/branches/branches.service';
import { type StorageService } from '../src/storage/storage.service';
import { type ExamTypesService } from '../src/configs';
import { FakePrisma, makeGroup, makeStudent } from './support/fakes';

/**
 * Deactivation revokes access, and access runs Student → Group → TestSeries → Test. So every path
 * that hands out a group is a path that can hand the access back, and each one is checked here.
 *
 * Neither service touches its second dependency on these paths, so neither is built.
 */
const MORNING = 'grp_morning';
const EVENING = 'grp_evening';

function servicesWith(
  students = [makeStudent()],
  groupRows = [
    makeGroup({ id: MORNING, name: 'SSC CGL MORNING' }),
    makeGroup({ id: EVENING, name: 'SSC CGL EVENING' }),
  ],
) {
  const prisma = new FakePrisma(students, [], [], groupRows);
  return {
    prisma,
    groups: new GroupsService(
      prisma.asService(),
      undefined as unknown as BranchesService,
      undefined as unknown as ExamTypesService,
    ),
    studentsService: new StudentsService(
      prisma.asService(),
      undefined as unknown as StorageService,
      undefined as unknown as ExamTypesService,
      undefined as unknown as BranchesService,
    ),
  };
}

const active = (over = {}) => makeStudent({ id: 'stu_active', mobile: '9876543210', ...over });
/**
 * ONLY `isTestBlocked`. `isActive` deliberately stays true: with both set, this file would pass
 * against a half-flipped codebase, which is the exact thing it was written to catch.
 */
const deactivated = (over = {}) =>
  makeStudent({ id: 'stu_off', mobile: '9000000000', isTestBlocked: true, ...over });

describe('GroupsService.addMembers — deactivated students', () => {
  it('adds an active student', async () => {
    const { groups, prisma } = servicesWith([active()]);

    const result = await groups.addMembers(MORNING, ['stu_active']);

    assert.equal(result.added, 1);
    assert.deepEqual(prisma.students[0]?.directGroupIds, [MORNING]);
  });

  it('refuses a deactivated student, and writes nothing', async () => {
    const { groups, prisma } = servicesWith([deactivated()]);

    const error = await groups.addMembers(MORNING, ['stu_off']).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    assert.ok(error instanceof AppException);
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.match(error.message, /blocked from tests/i);
    assert.deepEqual(
      prisma.students[0]?.directGroupIds,
      [],
      'the whole add is refused, not filtered',
    );
  });

  /** Selecting a page and adding it is the normal way this is used; one bad row stops all of it. */
  it('refuses the whole add when one of several is deactivated, naming the count', async () => {
    const { groups, prisma } = servicesWith([active(), deactivated()]);

    const error = await groups.addMembers(MORNING, ['stu_active', 'stu_off']).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    assert.ok(error instanceof AppException);
    assert.deepEqual(error.fieldErrors?.studentIds?.length, 1);
    assert.deepEqual(
      prisma.students.flatMap((student) => student.directGroupIds),
      [],
    );
  });

  /**
   * Re-adding somebody who is already in the group is a no-op, and must stay one: an admin
   * re-submitting a page they already added should not be told off about a student they are
   * not actually moving.
   */
  it('says nothing about a deactivated student already in the group', async () => {
    const { groups } = servicesWith(
      [deactivated({ directGroupIds: [MORNING] })],
      [makeGroup({ id: MORNING })],
    );

    const result = await groups.addMembers(MORNING, ['stu_off']);

    assert.equal(result.added, 0);
    assert.equal(result.alreadyMembers, 1);
  });

  /**
   * Sign-in and test access are separate switches. Somebody whose sign-in is suspended still
   * belongs to their course, and an admin arranging next term's groups must not be stopped.
   */
  it('adds a student whose sign-in is suspended but whose tests are not blocked', async () => {
    const { groups, prisma } = servicesWith([
      makeStudent({ id: 'stu_nosignin', mobile: '9111111111', isActive: false }),
    ]);

    const result = await groups.addMembers(MORNING, ['stu_nosignin']);

    assert.equal(result.added, 1);
    assert.deepEqual(prisma.students[0]?.directGroupIds, [MORNING]);
  });
});

describe('StudentsService.update — deactivated students', () => {
  it('lets an active student change groups', async () => {
    const { studentsService, prisma } = servicesWith([active({ directGroupIds: [MORNING] })]);

    await studentsService.update('stu_active', { groupIds: [MORNING, EVENING] });

    assert.deepEqual(prisma.students[0]?.directGroupIds, [MORNING, EVENING]);
  });

  it('refuses to put a deactivated student into a group they are not in', async () => {
    const { studentsService, prisma } = servicesWith([deactivated({ directGroupIds: [MORNING] })]);

    const error = await studentsService.update('stu_off', { groupIds: [MORNING, EVENING] }).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    assert.ok(error instanceof AppException);
    assert.match(error.message, /blocked from tests/i);
    assert.ok(error.fieldErrors?.groupIds);
    assert.deepEqual(prisma.students[0]?.directGroupIds, [MORNING], 'nothing changed');
  });

  /**
   * Their existing groups are still theirs, and one of them can still be given up — this rule
   * blocks gaining a group, not keeping or losing one.
   */
  it('lets a deactivated student be taken out of a group they are in', async () => {
    const { studentsService, prisma } = servicesWith([
      deactivated({ directGroupIds: [MORNING, EVENING] }),
    ]);

    const detail = await studentsService.update('stu_off', { groupIds: [MORNING] });

    assert.deepEqual(
      detail.groups.map((group) => group.id),
      [MORNING],
    );
    assert.deepEqual(prisma.students[0]?.directGroupIds, [MORNING]);
  });

  it('lets a student whose sign-in is suspended join a group', async () => {
    const { studentsService, prisma } = servicesWith([
      makeStudent({ id: 'stu_nosignin', mobile: '9111111111', isActive: false }),
    ]);

    await studentsService.update('stu_nosignin', { groupIds: [MORNING] });

    assert.deepEqual(prisma.students[0]?.directGroupIds, [MORNING]);
  });
});

describe('StudentsService.update — the grant path from the detail form', () => {
  it('refuses to add a group that is reached by an enrolment', async () => {
    const { studentsService, prisma } = servicesWith(
      [active()],
      [makeGroup({ id: MORNING, type: GROUP_TYPE.EXAM, examType: 'SSC CGL' })],
    );

    const error = await studentsService
      .update('stu_active', { groupIds: [MORNING] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.groupIds);
    assert.deepEqual(prisma.students[0]?.directGroupIds, []);
  });

  /** Diffed against what they hold: a grant made before the rule existed is still removable. */
  it('lets a stale grant be dropped without re-checking it', async () => {
    const { studentsService, prisma } = servicesWith(
      [active({ directGroupIds: [MORNING, EVENING] })],
      [
        makeGroup({ id: MORNING, type: GROUP_TYPE.EXAM, examType: 'SSC CGL' }),
        makeGroup({ id: EVENING, type: GROUP_TYPE.SCHOLARSHIP }),
      ],
    );

    await studentsService.update('stu_active', { groupIds: [EVENING] });

    assert.deepEqual(prisma.students[0]?.directGroupIds, [EVENING]);
  });
});

describe('StudentsService.create — the grant path from the "Add a student" form', () => {
  /**
   * The failure this prevents: creating straight into an EXAM/GLOBAL group is the same no-op grant
   * as adding one after the fact, on the path an admin actually uses day to day.
   */
  it('refuses to create a student holding a group reached by an enrolment', async () => {
    const { studentsService, prisma } = servicesWith(
      [],
      [makeGroup({ id: MORNING, type: GROUP_TYPE.EXAM, examType: 'SSC CGL' })],
    );

    const error = await studentsService
      .create({ mobile: '9876543210', studentType: STUDENT_TYPE.ONLINE, groupIds: [MORNING] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.groupIds);
    assert.equal(prisma.students.length, 0);
  });

  /** Nothing is held yet, so this is the create-time equivalent of a fresh grant — every id is joining. */
  it('creates a student holding a scholarship group', async () => {
    const { studentsService, prisma } = servicesWith(
      [],
      [makeGroup({ id: EVENING, type: GROUP_TYPE.SCHOLARSHIP })],
    );

    await studentsService.create({
      mobile: '9876543210',
      studentType: STUDENT_TYPE.ONLINE,
      groupIds: [EVENING],
    });

    assert.deepEqual(prisma.students[0]?.directGroupIds, [EVENING]);
  });
});
