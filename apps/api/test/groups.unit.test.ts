import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BRANCH_TYPE,
  GROUP_REACH,
  GROUP_TYPE,
  acceptsDirectGrants,
  addGroupMembersSchema,
  createGroupSchema,
  deactivatedMemberBlocker,
  groupListQuerySchema,
  groupReach,
  groupShapeIssue,
  groupSummarySchema,
  requiresExamType,
  updateGroupSchema,
} from '@iace/contracts';
import { groupDeletionBlocker, groupEditBlocker } from '../src/groups/group-rules';

/**
 * Access runs Student → Group → TestSeries → Test, so `groupDeletionBlocker` exists to stop a
 * routine bit of housekeeping from silently revoking someone's access, and `groupEditBlocker`
 * protects the one group — GLOBAL — that is seeded once and re-created by nothing.
 */

describe('groupDeletionBlocker', () => {
  const empty = { type: GROUP_TYPE.SCHOLARSHIP, studentCount: 0, testSeriesCount: 0 };

  it('allows deleting a group nothing depends on', () => {
    assert.equal(groupDeletionBlocker(empty), null);
  });

  /**
   * The failure this prevents: the count is type-aware now, so an EXAM group thousands of students
   * reach no longer reports 0 and no longer passes this.
   */
  it('refuses while students are still in it, and says how many', () => {
    const blocker = groupDeletionBlocker({ ...empty, type: GROUP_TYPE.EXAM, studentCount: 12 });

    assert.ok(blocker);
    assert.match(blocker, /12 students/);
  });

  it('gets the singular right, because an admin reads this message', () => {
    assert.match(groupDeletionBlocker({ ...empty, studentCount: 1 })!, /1 student\./);
  });

  it('refuses while a test series is still linked, even with no students', () => {
    assert.match(groupDeletionBlocker({ ...empty, testSeriesCount: 2 })!, /test series/);
  });

  it('reports the students first — it is the one the admin must act on', () => {
    assert.match(
      groupDeletionBlocker({ ...empty, studentCount: 3, testSeriesCount: 3 })!,
      /students/,
    );
  });

  /** Seeded by a migration, reached by everybody, and re-created by nothing. */
  it('never deletes the all-students group, empty or not', () => {
    assert.ok(groupDeletionBlocker({ ...empty, type: GROUP_TYPE.GLOBAL }));
  });
});

describe('groupEditBlocker', () => {
  it('leaves an ordinary group alone', () => {
    assert.equal(groupEditBlocker({ type: GROUP_TYPE.EXAM }, { name: 'SSC EVENING' }), null);
    assert.equal(groupEditBlocker({ type: GROUP_TYPE.SCHOLARSHIP }, { isActive: false }), null);
  });

  it('refuses to rename or retire the all-students group', () => {
    assert.match(groupEditBlocker({ type: GROUP_TYPE.GLOBAL }, { name: 'EVERYONE' })!, /renamed/);
    assert.match(groupEditBlocker({ type: GROUP_TYPE.GLOBAL }, { isActive: false })!, /retired/);
  });

  /**
   * Deliberately unlike `branchEditBlocker`, which permits a no-op patch on its protected row:
   * this row has no editable state at all, so re-setting a value it already holds is still refused.
   */
  it('refuses a patch that would change nothing', () => {
    assert.ok(groupEditBlocker({ type: GROUP_TYPE.GLOBAL }, { isActive: true }));
  });
});

describe('deactivatedMemberBlocker', () => {
  it('allows an add where every student is active', () => {
    assert.equal(deactivatedMemberBlocker(0), null);
  });

  /**
   * A group is a route to a test, so granting one to a deactivated account hands back
   * exactly what the deactivation took away — quietly, and without reactivating them.
   */
  it('refuses an add that includes a deactivated student', () => {
    const blocker = deactivatedMemberBlocker(1);

    assert.ok(blocker);
    assert.match(blocker, /deactivated/i);
    assert.match(blocker, /reactivate/i, 'and says what to do about it');
  });

  it('says how many, because an admin reads this message', () => {
    assert.match(deactivatedMemberBlocker(4)!, /4 of those students/);
  });

  it('gets the singular right', () => {
    assert.match(deactivatedMemberBlocker(1)!, /That student is/);
  });
});

describe('group contracts', () => {
  const exam = {
    name: 'SSC Morning',
    type: GROUP_TYPE.EXAM,
    examType: 'ssc cgl',
    branchIds: ['b1'],
  };

  it('requires a usable group name', () => {
    assert.equal(createGroupSchema.safeParse(exam).success, true);
    assert.equal(createGroupSchema.safeParse({ ...exam, name: 'A' }).success, false);
    assert.equal(createGroupSchema.safeParse({ ...exam, name: '   ' }).success, false);
  });

  /** An EXAM group is reached by an enrolment matching its code, so a null one reaches nobody. */
  it('requires an exam and a branch for the types that are reached by one', () => {
    assert.equal(createGroupSchema.safeParse({ ...exam, examType: undefined }).success, false);
    assert.equal(createGroupSchema.safeParse({ ...exam, branchIds: [] }).success, false);
    assert.equal(createGroupSchema.safeParse({ ...exam, type: GROUP_TYPE.PROGRAM }).success, true);
  });

  /** A scholarship group is granted student by student, so an exam code on it would be a lie. */
  it('forbids an exam on the types that are granted one at a time, and asks for no branch', () => {
    const grant = { name: 'MERIT 2026', type: GROUP_TYPE.SCHOLARSHIP };
    assert.equal(createGroupSchema.safeParse(grant).success, true);
    assert.equal(createGroupSchema.safeParse({ ...grant, examType: 'SSC CGL' }).success, false);
  });

  it('refuses to create a second all-students group', () => {
    const parsed = createGroupSchema.safeParse({ name: 'EVERYONE', type: GROUP_TYPE.GLOBAL });
    assert.equal(parsed.success, false);
    assert.equal(parsed.error?.issues[0]?.path[0], 'type');
  });

  it('canonicalises the name and the exam code, so "SSC " and "ssc" cannot both exist', () => {
    const parsed = createGroupSchema.parse({ ...exam, name: '  SSC Morning  ' });
    assert.equal(parsed.name, 'SSC MORNING');
    assert.equal(parsed.examType, 'SSC CGL');
  });

  /** Retyping a group silently changes who reaches it, and GLOBAL could be retyped into existence. */
  it('refuses to retype a group on update', () => {
    assert.equal('type' in updateGroupSchema.parse({ type: GROUP_TYPE.PROGRAM } as never), false);
  });

  it('lets a group be moved between branches and retired on update', () => {
    assert.deepEqual(updateGroupSchema.parse({ branchIds: ['b1', 'b2'] }).branchIds, ['b1', 'b2']);
    assert.equal(updateGroupSchema.parse({ isActive: false }).isActive, false);
  });

  it('treats update as a patch — an empty body is valid and changes nothing', () => {
    assert.equal(updateGroupSchema.safeParse({}).success, true);
  });

  it('refuses an empty add — an admin meant to pick someone', () => {
    assert.equal(addGroupMembersSchema.safeParse({ studentIds: [] }).success, false);
    assert.equal(addGroupMembersSchema.safeParse({ studentIds: ['stu_1'] }).success, true);
  });

  it('refuses an oversized page rather than quietly clamping it', () => {
    assert.equal(groupListQuerySchema.safeParse({ pageSize: '101' }).success, false);
    assert.equal(groupListQuerySchema.safeParse({ pageSize: '0' }).success, false);
    assert.equal(groupListQuerySchema.parse({ pageSize: '100' }).pageSize, 100);
  });

  it('defaults to page 1 of 20 when nothing is asked for', () => {
    assert.equal(groupListQuerySchema.parse({}).page, 1);
    assert.equal(groupListQuerySchema.parse({}).pageSize, 20);
  });

  it('carries the counts and the state a group list is opened to see', () => {
    const summary = {
      id: 'g1',
      name: 'SSC MORNING',
      type: GROUP_TYPE.EXAM,
      examType: 'SSC CGL',
      isActive: true,
      branches: [{ id: 'b1', name: 'AMEERPET', type: BRANCH_TYPE.PHYSICAL }],
      description: null,
      studentCount: 42,
      testSeriesCount: 2,
      createdAt: new Date().toISOString(),
    };
    assert.equal(groupSummarySchema.safeParse(summary).success, true);

    const { isActive: _a, ...withoutState } = summary;
    assert.equal(groupSummarySchema.safeParse(withoutState).success, false);
  });
});

describe('groupReach — one answer for the count, the roster filter and the resolver', () => {
  it('reaches everybody through the all-students group', () => {
    assert.equal(groupReach({ type: GROUP_TYPE.GLOBAL, examType: null }), GROUP_REACH.EVERYONE);
  });

  it('reaches an exam group through the enrolment that names it', () => {
    assert.equal(groupReach({ type: GROUP_TYPE.EXAM, examType: 'SSC CGL' }), GROUP_REACH.ENROLMENT);
    assert.equal(
      groupReach({ type: GROUP_TYPE.PROGRAM, examType: 'SSC CGL' }),
      GROUP_REACH.ENROLMENT,
    );
  });

  /**
   * The failure this prevents: an EXAM group with no code silently counting the whole roster
   * or nobody. With no code there is nothing to match, so only an explicit grant reaches it.
   */
  it('falls back to explicit grants for an exam group carrying no code', () => {
    assert.equal(groupReach({ type: GROUP_TYPE.EXAM, examType: null }), GROUP_REACH.GRANT);
    assert.equal(groupReach({ type: GROUP_TYPE.SCHOLARSHIP, examType: null }), GROUP_REACH.GRANT);
  });
});

describe('groupShapeIssue — the same rule the form and the API run', () => {
  it('passes a shape that is already right', () => {
    assert.equal(
      groupShapeIssue({ type: GROUP_TYPE.EXAM, examType: 'SSC CGL', branchIds: ['b1'] }),
      null,
    );
  });

  it('names the field an admin has to fix', () => {
    assert.equal(
      groupShapeIssue({ type: GROUP_TYPE.EXAM, examType: null, branchIds: ['b1'] })?.path,
      'examType',
    );
    assert.equal(
      groupShapeIssue({ type: GROUP_TYPE.EXAM, examType: 'SSC CGL', branchIds: [] })?.path,
      'branchIds',
    );
    assert.equal(
      groupShapeIssue({ type: GROUP_TYPE.NON_IACE, examType: 'SSC CGL' })?.path,
      'examType',
    );
  });

  /** A PATCH sets some fields. An absent one is not being changed, so it cannot be wrong. */
  it('skips a field the patch does not carry', () => {
    assert.equal(groupShapeIssue({ type: GROUP_TYPE.EXAM }), null);
  });
});

describe('which groups take a student one at a time', () => {
  it('accepts a grant only for scholarship and non-IACE', () => {
    assert.deepEqual(Object.values(GROUP_TYPE).filter(acceptsDirectGrants), [
      GROUP_TYPE.SCHOLARSHIP,
      GROUP_TYPE.NON_IACE,
    ]);
  });

  it('asks for an exam code only where an enrolment reaches it', () => {
    assert.deepEqual(Object.values(GROUP_TYPE).filter(requiresExamType), [
      GROUP_TYPE.EXAM,
      GROUP_TYPE.PROGRAM,
    ]);
  });
});
