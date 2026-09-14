import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fieldDiff } from '@iace/contracts';
import { AUDITED_BRANCH_FIELDS } from '../src/branches/branches.service';

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
