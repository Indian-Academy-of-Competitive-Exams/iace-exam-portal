import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { updateMeSchema, updateStudentSchema } from '@iace/contracts';

/** A student's own account. The guarantees here are the ones that decide whether a student can quietly grant themselves something, or lock somebody else out. */
describe('updateMeSchema — what a student may change about themselves', () => {
  it('accepts the ordinary details', () => {
    const parsed = updateMeSchema.parse({
      fullName: 'Asha Kumari',
      profile: { motherName: 'Sita Devi', dob: '2003-04-11' },
    });

    assert.equal(parsed.fullName, 'Asha Kumari');
    assert.equal(parsed.profile?.motherName, 'Sita Devi');
  });

  /** The failure this prevents: group membership is what grants access to tests, so a student who could set their own groups could enrol themselves in any batch in the institute — including one sitting a paper they are not meant to see. */
  it('SILENTLY DROPS groupIds — a student cannot grant themselves access', () => {
    const parsed = updateMeSchema.parse({
      fullName: 'Asha Kumari',
      groupIds: ['g_someone_elses_batch'],
    } as never);

    assert.equal('groupIds' in parsed, false, 'groupIds must not survive parsing');
    assert.equal(JSON.stringify(parsed).includes('g_someone_elses_batch'), false);
  });

  it('is otherwise the same rules the admin edit uses', () => {
    // Same letters-only name rule, same future-DOB refusal — one definition, so a student cannot save something an admin would have been refused.
    assert.equal(updateMeSchema.safeParse({ fullName: 'Ravi, Kumar' }).success, false);
    assert.equal(updateMeSchema.safeParse({ profile: { dob: '2030-01-01' } }).success, false);
    assert.equal(updateStudentSchema.safeParse({ fullName: 'Ravi, Kumar' }).success, false);
  });

  it('treats an empty patch as "change nothing" rather than an error', () => {
    assert.equal(updateMeSchema.safeParse({}).success, true);
  });
});
