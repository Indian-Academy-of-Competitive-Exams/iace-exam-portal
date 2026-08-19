import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  GROUP_TYPE,
  createGroupSchema,
  groupListQuerySchema,
  type CreateGroupInput,
} from '@iace/contracts';
import { GroupsService } from '../src/groups/groups.service';
import { BranchesService } from '../src/branches/branches.service';
import { type ExamTypesService } from '../src/configs';
import { FakePrisma, makeBranch, makeGroup, makeStudent } from './support/fakes';

/**
 * The exam-type seam, stubbed rather than built: what matters here is that the group service asks,
 * and that it asks against the field the GROUP form owns.
 */
class StubExamTypes {
  readonly asked: { codes: string[]; fieldKey: string }[] = [];

  constructor(private readonly known: string[] = ['SSC CGL', 'SSC CHSL']) {}

  assertUsable(codes: string[], fieldKey: string): Promise<void> {
    this.asked.push({ codes, fieldKey });
    if (codes.every((code) => this.known.includes(code))) return Promise.resolve();
    return Promise.reject(
      new AppException(ErrorCodes.VALIDATION_ERROR, 'No such exam type', {
        fieldErrors: { [fieldKey]: ['No such exam type'] },
      }),
    );
  }

  asService(): ExamTypesService {
    return this as unknown as ExamTypesService;
  }
}

function serviceWith(
  groups = [] as ReturnType<typeof makeGroup>[],
  students = [] as ReturnType<typeof makeStudent>[],
) {
  const branches = [makeBranch({ id: 'br_1' }), makeBranch({ id: 'br_2', name: 'KUKATPALLY' })];
  const prisma = new FakePrisma(students, [], branches, groups, []);
  const examTypes = new StubExamTypes();
  const service = new GroupsService(
    prisma.asService(),
    new BranchesService(prisma.asService()),
    examTypes.asService(),
  );
  return { service, prisma, examTypes };
}

/** A body the way the controller's pipe would hand one over. */
const body = (over: Partial<CreateGroupInput> = {}) =>
  createGroupSchema.parse({
    name: 'SSC CGL MORNING',
    type: GROUP_TYPE.EXAM,
    examType: 'SSC CGL',
    branchIds: ['br_1'],
    ...over,
  });

describe('GroupsService — creating', () => {
  it('stores the type, the exam code and every branch', async () => {
    const { service, prisma } = serviceWith();

    const created = await service.create(body({ branchIds: ['br_1', 'br_2'] }));

    assert.equal(created.type, GROUP_TYPE.EXAM);
    assert.equal(created.examType, 'SSC CGL');
    assert.deepEqual(
      created.branches.map((branch) => branch.id),
      ['br_1', 'br_2'],
    );
    assert.equal(prisma.groups.length, 1);
  });

  it('validates the exam code against the catalog, keyed to the group form’s field', async () => {
    const { service, examTypes } = serviceWith();

    await service.create(body());

    assert.deepEqual(examTypes.asked, [{ codes: ['SSC CGL'], fieldKey: 'examType' }]);
  });

  it('refuses an unknown exam code rather than storing a dangling one', async () => {
    const { service, prisma } = serviceWith();

    const error = await service.create(body({ examType: 'SSC MTS' })).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.examType);
    assert.equal(prisma.groups.length, 0);
  });

  it('refuses a retired branch', async () => {
    const { service, prisma } = serviceWith();
    prisma.branches[1]!.isActive = false;

    const error = await service.create(body({ branchIds: ['br_2'] })).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.branchId);
  });

  /** Two SSC CGL MORNINGs under one exam are the same batch typed twice. */
  it('refuses a duplicate name within the exam, against the field', async () => {
    const { service } = serviceWith([
      makeGroup({ id: 'g1', name: 'SSC CGL MORNING', type: GROUP_TYPE.EXAM, examType: 'SSC CGL' }),
    ]);

    const error = await service.create(body()).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.ok(error.fieldErrors?.name);
  });

  it('allows the same name under a different exam', async () => {
    const { service } = serviceWith([
      makeGroup({ id: 'g1', name: 'SSC CGL MORNING', type: GROUP_TYPE.EXAM, examType: 'SSC CHSL' }),
    ]);

    await assert.doesNotReject(() => service.create(body()));
  });
});

describe('GroupsService — updating', () => {
  const existing = () =>
    makeGroup({
      id: 'g1',
      name: 'SSC CGL MORNING',
      type: GROUP_TYPE.EXAM,
      examType: 'SSC CGL',
      branches: [{ id: 'br_1', name: 'AMEERPET', type: 'PHYSICAL' }],
    });

  it('moves a group between branches', async () => {
    const { service } = serviceWith([existing()]);

    const updated = await service.update('g1', { branchIds: ['br_2'] });

    assert.deepEqual(
      updated.branches.map((branch) => branch.id),
      ['br_2'],
    );
  });

  it('retires a group without touching anything else', async () => {
    const { service, prisma } = serviceWith([existing()]);

    const updated = await service.update('g1', { isActive: false });

    assert.equal(updated.isActive, false);
    assert.equal(prisma.groups[0]?.name, 'SSC CGL MORNING');
  });

  /**
   * The live bug this closes: the old check read the STORED exam code and skipped entirely unless the
   * name changed, so moving a group onto an exam that already had that name reached the unique index
   * and came back as a bare P2002 with nothing for the form to show.
   */
  it('refuses a move onto an exam that already has that name, against the field', async () => {
    const { service } = serviceWith([
      existing(),
      makeGroup({ id: 'g2', name: 'SSC CGL MORNING', type: GROUP_TYPE.EXAM, examType: 'SSC CHSL' }),
    ]);

    const error = await service.update('g1', { examType: 'SSC CHSL' }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.ok(error.fieldErrors?.name);
  });

  /** Its own row is not a clash — a patch that renames nothing must still save. */
  it('lets a group keep the name it already has', async () => {
    const { service } = serviceWith([existing()]);

    await assert.doesNotReject(() => service.update('g1', { name: 'SSC CGL MORNING' }));
  });

  it('refuses to empty the branches of a group reached by an exam', async () => {
    const { service } = serviceWith([existing()]);

    const error = await service.update('g1', { branchIds: [] }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.branchIds);
  });

  it('refuses an exam code on a group that is granted one student at a time', async () => {
    const { service } = serviceWith([
      makeGroup({ id: 'g3', name: 'MERIT 2026', type: GROUP_TYPE.SCHOLARSHIP }),
    ]);

    const error = await service.update('g3', { examType: 'SSC CGL' }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.examType);
  });

  it('refuses to rename or retire the all-students group', async () => {
    const { service } = serviceWith([
      makeGroup({ id: 'g_all', name: 'ALL STUDENTS', type: GROUP_TYPE.GLOBAL }),
    ]);

    const error = await service.update('g_all', { isActive: false }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
  });
});

describe('GroupsService — who counts as a member', () => {
  const roster = [
    makeStudent({ id: 'stu_1', mobile: '9000000001', enrolledExams: ['SSC CGL'] }),
    makeStudent({ id: 'stu_2', mobile: '9000000002', enrolledExams: ['SSC CHSL'] }),
    makeStudent({ id: 'stu_3', mobile: '9000000003', directGroupIds: ['g_merit'] }),
    makeStudent({ id: 'stu_4', mobile: '9000000004', deletedAt: new Date('2026-02-01') }),
  ];

  /**
   * The failure this exists to prevent: counting `directGroupIds` alone reads 0 for an EXAM group,
   * so the delete blocker passed a batch of thousands under "nobody loses access".
   */
  it('counts an exam group by the enrolment that reaches it', async () => {
    const { service } = serviceWith(
      [makeGroup({ id: 'g1', type: GROUP_TYPE.EXAM, examType: 'SSC CGL' })],
      roster,
    );

    const group = await service.detail('g1');

    assert.equal(group.studentCount, 1);
  });

  /** `stu_4` is soft-deleted: LIVE roster is 3, not the 4 rows in the table. */
  it('counts the all-students group as the whole live roster', async () => {
    const { service } = serviceWith(
      [makeGroup({ id: 'g_all', name: 'ALL STUDENTS', type: GROUP_TYPE.GLOBAL })],
      roster,
    );

    assert.equal((await service.detail('g_all')).studentCount, 3);
  });

  it('counts a scholarship group by its explicit grants', async () => {
    const { service } = serviceWith(
      [makeGroup({ id: 'g_merit', name: 'MERIT 2026', type: GROUP_TYPE.SCHOLARSHIP })],
      roster,
    );

    assert.equal((await service.detail('g_merit')).studentCount, 1);
  });

  it('refuses to delete an exam group its enrolments still reach', async () => {
    const { service, prisma } = serviceWith(
      [makeGroup({ id: 'g1', type: GROUP_TYPE.EXAM, examType: 'SSC CGL' })],
      roster,
    );

    const error = await service.remove('g1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.match(error.message, /1 student/);
    assert.equal(prisma.groups.length, 1);
  });

  it('deletes a group nothing reaches', async () => {
    const { service, prisma } = serviceWith(
      [makeGroup({ id: 'g_empty', name: 'MERIT 2027', type: GROUP_TYPE.SCHOLARSHIP })],
      roster,
    );

    await service.remove('g_empty');

    assert.equal(prisma.groups.length, 0);
  });

  it('carries the same number into the list', async () => {
    const { service } = serviceWith(
      [makeGroup({ id: 'g1', type: GROUP_TYPE.EXAM, examType: 'SSC CGL' })],
      roster,
    );

    const page = await service.list(groupListQuerySchema.parse({}));

    assert.equal(page.items[0]?.studentCount, 1);
  });
});

describe('GroupsService.addMembers — only the types a grant means anything for', () => {
  /**
   * The failure this prevents: a student added to an EXAM group gains a row that grants nothing,
   * because access to that group comes from their enrolment. The click reports success.
   */
  it('refuses to grant an exam group one student at a time', async () => {
    const { service, prisma } = serviceWith(
      [makeGroup({ id: 'g1', type: GROUP_TYPE.EXAM, examType: 'SSC CGL' })],
      [makeStudent({ id: 'stu_1' })],
    );

    const error = await service.addMembers('g1', ['stu_1']).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.studentIds);
    assert.deepEqual(prisma.students[0]?.directGroupIds, []);
  });

  it('grants a scholarship group', async () => {
    const { service, prisma } = serviceWith(
      [makeGroup({ id: 'g_merit', type: GROUP_TYPE.SCHOLARSHIP })],
      [makeStudent({ id: 'stu_1' })],
    );

    await service.addMembers('g_merit', ['stu_1']);

    assert.deepEqual(prisma.students[0]?.directGroupIds, ['g_merit']);
  });

  /** A stale grant must always be removable, whatever the group turned out to be. */
  it('still removes a student from a group that no longer takes grants', async () => {
    const { service, prisma } = serviceWith(
      [makeGroup({ id: 'g1', type: GROUP_TYPE.EXAM, examType: 'SSC CGL' })],
      [makeStudent({ id: 'stu_1', directGroupIds: ['g1'] })],
    );

    await service.removeMember('g1', 'stu_1');

    assert.deepEqual(prisma.students[0]?.directGroupIds, []);
  });
});
