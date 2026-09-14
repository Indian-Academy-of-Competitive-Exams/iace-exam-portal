import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TOMBSTONE_MOBILE, anonymizedProfile } from '../src/students/anonymize';

describe('the tombstone', () => {
  /** A live mobile always starts 6-9, so nothing real can ever collide with the tombstone. */
  it('is a number no student can hold', () => {
    assert.match(TOMBSTONE_MOBILE, /^0+$/);
  });

  it('empties every field the profile holds about a person', () => {
    const scrubbed = anonymizedProfile();

    for (const field of ['motherName', 'fatherName', 'dob', 'email', 'address', 'gender']) {
      assert.equal(scrubbed[field as keyof typeof scrubbed], null, field);
    }
    assert.equal(scrubbed.aadhaarVerified, false);
    assert.equal(scrubbed.panVerified, false);
  });
});
