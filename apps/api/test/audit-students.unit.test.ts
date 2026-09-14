import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fieldDiff, STUDENT_TYPE } from '@iace/contracts';
import { AUDITED_STUDENT_FIELDS } from '../src/students/students.service';

/** The audited columns of one student, as the service reads the row before a write. */
const student = {
  fullName: 'Asha',
  studentType: STUDENT_TYPE.ONLINE,
  enrolledExams: ['SSC CGL'],
  enrolledCourses: [],
  programs: [],
  currentBranchId: null,
  isActive: true,
  isTestBlocked: false,
};

/** The diff is computed in the service because only it holds both the row it read and what it writes. */
describe('the student audit diff', () => {
  it('names every field an admin can change from the student screens', () => {
    for (const field of Object.keys(student)) {
      assert.ok(
        (AUDITED_STUDENT_FIELDS as readonly string[]).includes(field),
        `${field} is settable and must be audited`,
      );
    }
  });

  it('reports the access fields an admin actually changed', () => {
    const after = { ...student, enrolledExams: ['SSC CGL', 'RRB JE'], isTestBlocked: true };

    const diff = fieldDiff(student, after, AUDITED_STUDENT_FIELDS as never);

    assert.deepEqual(diff?.isTestBlocked, { from: false, to: true });
    assert.deepEqual(diff?.enrolledExams, { from: ['SSC CGL'], to: ['SSC CGL', 'RRB JE'] });
  });

  /** A save that changed nothing must write no diff, or the log fills with empty rows. */
  it('reports nothing for a save that changed nothing', () => {
    assert.equal(fieldDiff(student, { ...student }, AUDITED_STUDENT_FIELDS as never), null);
  });
});
