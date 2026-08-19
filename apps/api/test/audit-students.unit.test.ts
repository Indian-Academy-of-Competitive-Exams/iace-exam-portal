import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUDITED_STUDENT_FIELDS } from '../src/students/students.service';
import { fieldDiff } from '@iace/contracts';
import { makeStudent } from './support/fakes';

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
