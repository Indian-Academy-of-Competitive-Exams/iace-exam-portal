import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fieldDiff } from '@iace/contracts';
import { AUDITED_BRANCH_FIELDS, BranchesService } from '../src/branches/branches.service';
import { AuditContext } from '../src/audit';
import { FakeSeriesFanOut, FakePrisma, makeBranch } from './support/fakes';

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
// Driving the real service inside a live AuditContext, the way the interceptor
// actually reads it. Everything above is `fieldDiff` against hand-built objects,
// which cannot catch a wiring mistake in the service or in the fake it runs
// against — and did not: `FakePrisma.branch` handed back the same row it then
// mutated on `update`, so the diff below would have read `null` until that
// alias was closed.
// ============================================================================

describe('BranchesService.update — driven live, the diff a real edit contributes', () => {
  it('reports a retire', async () => {
    const prisma = new FakePrisma([], [], [makeBranch({ id: 'br_1', isActive: true })]);
    const auditContext = new AuditContext();
    const service = new BranchesService(
      prisma.asService(),
      new FakeSeriesFanOut().asService(),
      auditContext,
    );

    await auditContext.run(async () => {
      await service.update('br_1', { isActive: false });
      assert.deepEqual(auditContext.current()?.changed, { isActive: { from: true, to: false } });
    });
  });
});
