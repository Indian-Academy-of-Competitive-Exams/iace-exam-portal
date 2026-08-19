import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fieldDiff } from '@iace/contracts';
import { AUDITED_GROUP_FIELDS } from '../src/groups/groups.service';
import { AUDITED_BRANCH_FIELDS } from '../src/branches/branches.service';

describe('the group audit diff', () => {
  it('covers every column a group edit can change', () => {
    assert.deepEqual(
      [...AUDITED_GROUP_FIELDS],
      ['name', 'examType', 'branchIds', 'description', 'isActive'],
    );
  });

  /**
   * Retyping is refused, but re-coding is not, and an exam code decides who a group reaches.
   * That change is the one an admin most needs to find afterwards.
   */
  it('reports an exam code change, which changes who the group reaches', () => {
    const before: {
      name: string;
      examType: string | null;
      branchIds: string[];
      description: string | null;
      isActive: boolean;
    } = {
      name: 'SSC MORNING',
      examType: null,
      branchIds: ['b1'],
      description: null,
      isActive: true,
    };
    const diff = fieldDiff(before, { ...before, examType: 'SSC CGL' }, AUDITED_GROUP_FIELDS);

    assert.deepEqual(diff, { examType: { from: null, to: 'SSC CGL' } });
  });

  it('reports a branch move by value, not by array identity', () => {
    const before = {
      name: 'A',
      examType: null,
      branchIds: ['b1'],
      description: null,
      isActive: true,
    };

    assert.equal(fieldDiff(before, { ...before, branchIds: ['b1'] }, AUDITED_GROUP_FIELDS), null);
    assert.deepEqual(
      fieldDiff(before, { ...before, branchIds: ['b2'] }, AUDITED_GROUP_FIELDS)?.branchIds,
      { from: ['b1'], to: ['b2'] },
    );
  });
});

describe('the branch audit diff', () => {
  it('covers every column a branch edit can change', () => {
    assert.deepEqual([...AUDITED_BRANCH_FIELDS], ['name', 'isActive']);
  });

  /** Retiring is invisible from where it happens, which is why it is confirmed and logged. */
  it('reports a retire', () => {
    const before = { name: 'AMEERPET', isActive: true };

    assert.deepEqual(fieldDiff(before, { ...before, isActive: false }, AUDITED_BRANCH_FIELDS), {
      isActive: { from: true, to: false },
    });
  });
});
