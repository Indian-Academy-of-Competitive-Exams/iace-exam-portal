import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addGroupMembersSchema,
  createGroupSchema,
  groupListQuerySchema,
  groupSummarySchema,
  updateGroupSchema,
} from '@iace/contracts';
import {
  canRemoveFromGroup,
  groupDeletionBlocker,
  LAST_GROUP_MESSAGE,
} from '../src/groups/group-rules';

/**
 * Access runs Student → Group → TestSeries → Test, so both rules here exist to
 * stop a routine bit of housekeeping from silently revoking someone's access.
 * They are the reason a delete or a removal can be refused at all.
 */

describe('groupDeletionBlocker', () => {
  it('allows deleting a batch nothing depends on', () => {
    assert.equal(groupDeletionBlocker({ studentCount: 0, testSeriesCount: 0 }), null);
  });

  it('refuses while students are still in it, and says how many', () => {
    // Deleting a populated batch strips every member's route to their tests —
    // and since a student must stay in at least one, could leave them able to
    // reach nothing at all.
    const blocker = groupDeletionBlocker({ studentCount: 12, testSeriesCount: 0 });

    assert.ok(blocker);
    assert.match(blocker, /12 students/);
  });

  it('gets the singular right, because an admin reads this message', () => {
    assert.match(groupDeletionBlocker({ studentCount: 1, testSeriesCount: 0 })!, /1 student\./);
  });

  it('refuses while a test series is still linked, even with no students', () => {
    const blocker = groupDeletionBlocker({ studentCount: 0, testSeriesCount: 2 });

    assert.ok(blocker);
    assert.match(blocker, /test series/);
  });

  it('reports the students first — it is the one the admin must act on', () => {
    assert.match(groupDeletionBlocker({ studentCount: 3, testSeriesCount: 3 })!, /students/);
  });
});

describe('canRemoveFromGroup', () => {
  it('allows removal while the student has another batch', () => {
    assert.equal(canRemoveFromGroup(2), true);
    assert.equal(canRemoveFromGroup(9), true);
  });

  it('refuses to take a student out of their LAST batch', () => {
    // Dropping to zero groups reads to the student as "everything vanished"
    // and to the admin as a successful click.
    assert.equal(canRemoveFromGroup(1), false);
  });

  it('refuses on a nonsensical count rather than allowing it', () => {
    assert.equal(canRemoveFromGroup(0), false);
    assert.equal(canRemoveFromGroup(-1), false);
  });

  it('has a message that tells the admin what to do next', () => {
    assert.match(LAST_GROUP_MESSAGE, /another one/);
  });
});

describe("emptying a student's batches", () => {
  /** Mirrors StudentsService.update: refuse only when something is taken away. */
  const refuses = (currentCount: number, requested: string[]) =>
    requested.length === 0 && currentCount > 0;

  it('refuses to empty the batches of a student who has one', () => {
    assert.equal(refuses(1, []), true);
    assert.equal(refuses(3, []), true);
  });

  it('allows an empty set for a student who already has none — the regression', () => {
    // Self-signed-up students have no batch until an admin assigns one, and
    // refusing unconditionally made their record unsaveable: an admin could
    // not correct a name without first picking a batch they may not know.
    assert.equal(refuses(0, []), false);
  });

  it('never refuses when batches are actually being set', () => {
    assert.equal(refuses(0, ['g1']), false);
    assert.equal(refuses(2, ['g1']), false);
  });
});

describe('group contracts', () => {
  it('requires a usable batch name', () => {
    assert.equal(createGroupSchema.safeParse({ name: 'SSC Morning' }).success, true);
    assert.equal(createGroupSchema.safeParse({ name: 'A' }).success, false);
    assert.equal(createGroupSchema.safeParse({ name: '   ' }).success, false);
    assert.equal(createGroupSchema.safeParse({}).success, false);
  });

  it('trims a name, so "SSC " and "SSC" cannot both exist', () => {
    const parsed = createGroupSchema.parse({ name: '  SSC Morning  ' });
    assert.equal(parsed.name, 'SSC Morning');
  });

  it('treats update as a patch — an empty body is valid and changes nothing', () => {
    assert.equal(updateGroupSchema.safeParse({}).success, true);
  });

  it('refuses an empty add — an admin meant to pick someone', () => {
    assert.equal(addGroupMembersSchema.safeParse({ studentIds: [] }).success, false);
    assert.equal(addGroupMembersSchema.safeParse({ studentIds: ['stu_1'] }).success, true);
  });

  it('refuses an oversized page rather than quietly clamping it', () => {
    // Rejecting is the honest answer: a caller that asked for 500 and silently
    // received 100 would page through the list wrongly and never find out.
    assert.equal(groupListQuerySchema.safeParse({ pageSize: '101' }).success, false);
    assert.equal(groupListQuerySchema.safeParse({ pageSize: '500' }).success, false);
    assert.equal(groupListQuerySchema.safeParse({ pageSize: '0' }).success, false);
    assert.equal(groupListQuerySchema.parse({ pageSize: '100' }).pageSize, 100);
  });

  it('defaults to page 1 of 20 when nothing is asked for', () => {
    assert.equal(groupListQuerySchema.parse({}).page, 1);
    assert.equal(groupListQuerySchema.parse({}).pageSize, 20);
  });

  it('carries the counts a batch list is opened to see', () => {
    const summary = {
      id: 'g1',
      name: 'SSC Morning',
      branch: 'Ameerpet',
      description: null,
      studentCount: 42,
      testSeriesCount: 2,
      createdAt: new Date().toISOString(),
    };
    assert.equal(groupSummarySchema.safeParse(summary).success, true);

    const { studentCount: _c, ...withoutCount } = summary;
    assert.equal(groupSummarySchema.safeParse(withoutCount).success, false);
  });
});
