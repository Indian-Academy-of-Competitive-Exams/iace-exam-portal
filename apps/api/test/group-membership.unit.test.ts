import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes } from '@iace/contracts';
import { GroupsService } from '../src/groups/groups.service';
import { StudentsService } from '../src/students/students.service';
import { type BranchesService } from '../src/branches/branches.service';
import { type StorageService } from '../src/storage/storage.service';
import { FakePrisma, makeGroup, makeGroupRef, makeStudent } from './support/fakes';

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
    groups: new GroupsService(prisma.asService(), undefined as unknown as BranchesService),
    studentsService: new StudentsService(
      prisma.asService(),
      undefined as unknown as StorageService,
    ),
  };
}

const active = (over = {}) => makeStudent({ id: 'stu_active', mobile: '9876543210', ...over });
const deactivated = (over = {}) =>
  makeStudent({ id: 'stu_off', mobile: '9000000000', isActive: false, ...over });

describe('GroupsService.addMembers — deactivated students', () => {
  it('adds an active student', async () => {
    const { groups, prisma } = servicesWith([active()]);

    const result = await groups.addMembers(MORNING, ['stu_active']);

    assert.equal(result.added, 1);
    assert.deepEqual(prisma.groups[0]?.students, [{ id: 'stu_active' }]);
  });

  it('refuses a deactivated student, and writes nothing', async () => {
    const { groups, prisma } = servicesWith([deactivated()]);

    const error = await groups.addMembers(MORNING, ['stu_off']).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    assert.ok(error instanceof AppException);
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.match(error.message, /deactivated/i);
    assert.deepEqual(prisma.groups[0]?.students, [], 'the whole add is refused, not filtered');
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
    assert.deepEqual(prisma.groups[0]?.students, []);
  });

  /**
   * Re-adding somebody who is already in the group is a no-op, and must stay one: an admin
   * re-submitting a page they already added should not be told off about a student they are
   * not actually moving.
   */
  it('says nothing about a deactivated student already in the group', async () => {
    const { groups } = servicesWith(
      [deactivated({ groups: [makeGroupRef(MORNING)] })],
      [makeGroup({ id: MORNING, students: [{ id: 'stu_off' }] })],
    );

    const result = await groups.addMembers(MORNING, ['stu_off']);

    assert.equal(result.added, 0);
    assert.equal(result.alreadyMembers, 1);
  });
});

describe('StudentsService.update — deactivated students', () => {
  it('lets an active student change groups', async () => {
    const { studentsService, prisma } = servicesWith([active({ groups: [makeGroupRef(MORNING)] })]);

    await studentsService.update('stu_active', { groupIds: [MORNING, EVENING] });

    assert.deepEqual(prisma.students[0]?.groups.length, 2);
  });

  it('refuses to put a deactivated student into a group they are not in', async () => {
    const { studentsService, prisma } = servicesWith([
      deactivated({ groups: [makeGroupRef(MORNING)] }),
    ]);

    const error = await studentsService.update('stu_off', { groupIds: [MORNING, EVENING] }).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    assert.ok(error instanceof AppException);
    assert.match(error.message, /deactivated/i);
    assert.ok(error.fieldErrors?.groupIds);
    assert.deepEqual(
      prisma.students[0]?.groups.map((g) => g.id),
      [MORNING],
      'nothing changed',
    );
  });

  /**
   * Their existing groups are still theirs, and one of them can still be given up — this rule
   * blocks gaining a group, not keeping or losing one.
   */
  it('lets a deactivated student be taken out of a group they are in', async () => {
    const { studentsService, prisma } = servicesWith([
      deactivated({ groups: [makeGroupRef(MORNING), makeGroupRef(EVENING, 'SSC CGL EVENING')] }),
    ]);

    const detail = await studentsService.update('stu_off', { groupIds: [MORNING] });

    assert.deepEqual(
      detail.groups.map((group) => group.id),
      [MORNING],
    );
    assert.deepEqual(
      prisma.students[0]?.groups.map((group) => group.id),
      [MORNING],
    );
  });
});
