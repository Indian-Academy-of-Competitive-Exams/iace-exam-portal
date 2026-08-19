import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fieldDiff } from '@iace/contracts';
import { AUDITED_GROUP_FIELDS, GroupsService } from '../src/groups/groups.service';
import { AUDITED_BRANCH_FIELDS, BranchesService } from '../src/branches/branches.service';
import { AuditContext } from '../src/audit';
import { FakePrisma, makeBranch, makeGroup } from './support/fakes';

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

// ============================================================================
// Driving the real services inside a live AuditContext, the way the interceptor
// actually reads it. Everything above is `fieldDiff` against hand-built objects,
// which cannot catch a wiring mistake in the service or in the fake it runs
// against — and did not: `FakePrisma.group`/`.branch` handed back the same row
// they then mutated on `update`, so every diff below would have read `null`
// until that alias was closed.
// ============================================================================

describe('BranchesService.update — driven live, the diff a real edit contributes', () => {
  it('reports a retire', async () => {
    const prisma = new FakePrisma([], [], [makeBranch({ id: 'br_1', isActive: true })]);
    const auditContext = new AuditContext();
    const service = new BranchesService(prisma.asService(), auditContext);

    await auditContext.run(async () => {
      await service.update('br_1', { isActive: false });
      assert.deepEqual(auditContext.current()?.changed, { isActive: { from: true, to: false } });
    });
  });
});

describe('GroupsService.update — driven live, the diff a real edit contributes', () => {
  /** `branchIds` is the relation flattened to ids — this is the one shape most likely to break
   * quietly, so it gets the real before and after arrays rather than just a changed/unchanged check. */
  it('reports a branch move with the real before and after id arrays', async () => {
    const branchA = makeBranch({ id: 'br_a', name: 'AMEERPET' });
    const branchB = makeBranch({ id: 'br_b', name: 'DILSUKHNAGAR' });
    const group = makeGroup({
      id: 'grp_1',
      branches: [{ id: 'br_a', name: 'AMEERPET', type: branchA.type }],
    });
    const prisma = new FakePrisma([], [], [branchA, branchB], [group]);
    const auditContext = new AuditContext();
    const service = new GroupsService(
      prisma.asService(),
      new BranchesService(prisma.asService(), new AuditContext()),
      null as never,
      auditContext,
    );

    await auditContext.run(async () => {
      await service.update('grp_1', { branchIds: ['br_b'] });
      assert.deepEqual(auditContext.current()?.changed, {
        branchIds: { from: ['br_a'], to: ['br_b'] },
      });
    });
  });
});
