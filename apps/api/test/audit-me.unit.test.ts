import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fieldDiff } from '@iace/contracts';
import { AUDITED_PROFILE_FIELDS } from '../src/me/me.service';

describe('the student profile audit diff', () => {
  it('covers the profile fields a student can set about themselves', () => {
    for (const field of ['motherName', 'fatherName', 'dob', 'email', 'address', 'gender']) {
      assert.ok((AUDITED_PROFILE_FIELDS as readonly string[]).includes(field));
    }
  });

  /** The three pre-test fields are what a student is asked for before an exam, so a change to one after the fact is exactly the edit somebody will want to see. */
  it('reports a change to a pre-test field', () => {
    const before = {
      motherName: 'Lakshmi',
      fatherName: null,
      dob: null,
      email: null,
      address: null,
      gender: null,
    };

    assert.deepEqual(
      fieldDiff(before, { ...before, motherName: 'Laxmi' }, AUDITED_PROFILE_FIELDS as never),
      { motherName: { from: 'Lakshmi', to: 'Laxmi' } },
    );
  });
});
