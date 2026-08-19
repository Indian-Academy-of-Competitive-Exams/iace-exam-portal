import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { updateMeSchema } from '../src/me';

/**
 * A student patches their own record with no id in the path, so this schema is the only thing
 * standing between them and the fields that decide what they can reach.
 */
describe('updateMeSchema', () => {
  it('keeps the fields a student owns', () => {
    const parsed = updateMeSchema.parse({
      fullName: 'Asha Rao',
      preferredLanguage: 'hi',
      profile: { motherName: 'Lakshmi' },
    });

    assert.equal(parsed.fullName, 'Asha Rao');
    assert.equal(parsed.preferredLanguage, 'hi');
    assert.equal(parsed.profile?.motherName, 'Lakshmi');
  });

  /**
   * The failure this prevents: an enrolment reaches every EXAM and PROGRAM group for that code,
   * so a student who could set their own would grant themselves the whole test series.
   */
  it('strips every field that decides what the student can reach', () => {
    const parsed = updateMeSchema.parse({
      fullName: 'Asha Rao',
      enrolledExams: ['SSC CGL'],
      groupIds: ['grp_scholarship'],
      studentType: 'OFFLINE',
      currentBranchId: 'br_ameerpet',
      program: 'SSC CGL 2026',
    } as never);

    for (const key of ['enrolledExams', 'groupIds', 'studentType', 'currentBranchId', 'program']) {
      assert.equal(key in parsed, false, `${key} must never reach the service from /me`);
    }
  });
});
