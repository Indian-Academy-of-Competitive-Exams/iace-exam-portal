import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUDITED_STUDENT_FIELDS, StudentsService } from '../src/students/students.service';
import { fieldDiff } from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { type BranchesService } from '../src/branches/branches.service';
import { type ExamTypesService } from '../src/configs';
import { type StorageService } from '../src/storage/storage.service';
import { FakePrisma, makeProfile, makeStudent } from './support/fakes';

/**
 * The diff is computed in the service because only it holds both the row it read and the values
 * it is about to write. These assert the shape the audit row will carry.
 */
describe('the student audit diff', () => {
  it('names every field an admin can change from the student screens', () => {
    for (const field of [
      'fullName',
      'studentType',
      'enrolledExams',
      'program',
      'currentBranchId',
      'directGroupIds',
      'isActive',
      'isTestBlocked',
    ]) {
      assert.ok(
        (AUDITED_STUDENT_FIELDS as readonly string[]).includes(field),
        `${field} is settable and must be audited`,
      );
    }
  });

  it('reports the access fields an admin actually changed', () => {
    const before = makeStudent({ id: 'stu_1', enrolledExams: ['SSC CGL'], isTestBlocked: false });
    const after = { ...before, enrolledExams: ['SSC CGL', 'RRB JE'], isTestBlocked: true };

    const diff = fieldDiff(before, after, AUDITED_STUDENT_FIELDS as never);

    assert.deepEqual(diff?.isTestBlocked, { from: false, to: true });
    assert.deepEqual(diff?.enrolledExams, { from: ['SSC CGL'], to: ['SSC CGL', 'RRB JE'] });
  });

  /** A save that changed nothing must write no diff, or the log fills with empty rows. */
  it('reports nothing for a save that changed nothing', () => {
    const before = makeStudent({ id: 'stu_1' });

    assert.equal(fieldDiff(before, { ...before }, AUDITED_STUDENT_FIELDS as never), null);
  });
});

// ============================================================================
// Driving StudentsService inside a live AuditContext. It is the one service that
// merges a nested relation write — `profile: { upsert: … }` — into what is then
// treated as a row, and nothing exercised that shape.
// ============================================================================

function build(students = [makeStudent({ id: 'stu_1' })]) {
  const prisma = new FakePrisma(students);
  const auditContext = new AuditContext();
  // Neither reached: these tests never send `enrolledExams` or `currentBranchId`.
  const service = new StudentsService(
    prisma.asService(),
    {} as StorageService,
    {} as ExamTypesService,
    {} as BranchesService,
    auditContext,
  );
  return { prisma, auditContext, service };
}

describe('StudentsService.update — driven live, the diff a real admin edit contributes', () => {
  it('reports a rename with the real before and after values', async () => {
    const { auditContext, service } = build([makeStudent({ id: 'stu_1', fullName: 'Asha' })]);

    await auditContext.run(async () => {
      await service.update('stu_1', { fullName: 'Asha Rani' });

      assert.deepEqual(auditContext.current()?.changed, {
        fullName: { from: 'Asha', to: 'Asha Rani' },
      });
    });
  });

  /**
   * The failure this prevents: a profile edit puts `profile: { upsert: … }` — a relation write
   * operation, not a column — into the update payload. Spreading that payload over the row being
   * diffed installed the operation object as if it were a column value, and it was inert only
   * because `profile` happens to be absent from AUDITED_STUDENT_FIELDS.
   */
  it('never lets the profile relation write reach the diff as a column', async () => {
    const { auditContext, service } = build([
      makeStudent({ id: 'stu_1', fullName: 'Asha', profile: makeProfile() }),
    ]);

    await auditContext.run(async () => {
      await service.update('stu_1', {
        fullName: 'Asha Rani',
        profile: { motherName: 'Lakshmi' },
      });

      assert.deepEqual(auditContext.current()?.changed, {
        fullName: { from: 'Asha', to: 'Asha Rani' },
      });
    });
  });

  it('reports nothing for a save that changed nothing', async () => {
    const { auditContext, service } = build([makeStudent({ id: 'stu_1', fullName: 'Asha' })]);

    await auditContext.run(async () => {
      await service.update('stu_1', { fullName: 'Asha' });

      assert.equal(auditContext.current()?.changed, null);
    });
  });
});

describe('StudentsService toggles — driven live', () => {
  it('reports a deactivation', async () => {
    const { auditContext, service } = build([makeStudent({ id: 'stu_1', isActive: true })]);

    await auditContext.run(async () => {
      await service.setActive('stu_1', false);

      assert.deepEqual(auditContext.current()?.changed, { isActive: { from: true, to: false } });
    });
  });

  /**
   * The failure this prevents: re-activating an already-active student filed
   * `{ isActive: { from: true, to: true } }` — an audit row asserting a change that never
   * happened. The same noise the create-diff ruling refused, arriving by another door.
   */
  it('reports nothing when the toggle did not move', async () => {
    const { auditContext, service } = build([makeStudent({ id: 'stu_1', isActive: true })]);

    await auditContext.run(async () => {
      await service.setActive('stu_1', true);

      assert.equal(auditContext.current()?.changed, null);
    });
  });

  it('reports a test block, and nothing for a re-block', async () => {
    const { auditContext, service } = build([makeStudent({ id: 'stu_1', isTestBlocked: false })]);

    await auditContext.run(async () => {
      await service.setTestBlocked('stu_1', true);
      assert.deepEqual(auditContext.current()?.changed, {
        isTestBlocked: { from: false, to: true },
      });

      await service.setTestBlocked('stu_1', true);
      assert.equal(auditContext.current()?.changed, null);
    });
  });
});
