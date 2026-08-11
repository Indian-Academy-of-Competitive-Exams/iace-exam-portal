import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, studentDetailSchema, studentSummarySchema } from '@iace/contracts';
import { isPreTestReady, isProfileCompleted } from '../src/students/student-flags';

/**
 * The flag rules and the privacy boundary. Both are the sort of thing that
 * looks obviously right in review and is wrong in production, so they are
 * asserted rather than read.
 */

describe('isPreTestReady', () => {
  const ready = { motherName: 'Lakshmi', fatherName: 'Ravi', dob: new Date('2003-04-11') };

  it('needs all three of mother, father and DOB', () => {
    assert.equal(isPreTestReady(ready), true);
    assert.equal(isPreTestReady({ ...ready, motherName: null }), false);
    assert.equal(isPreTestReady({ ...ready, fatherName: null }), false);
    assert.equal(isPreTestReady({ ...ready, dob: null }), false);
  });

  it('treats whitespace as absent', () => {
    // "  " passes a NOT NULL check and fails a human one. The gate exists to
    // collect a real name, so a space is not an answer.
    assert.equal(isPreTestReady({ ...ready, motherName: '   ' }), false);
    assert.equal(isPreTestReady({ ...ready, fatherName: '' }), false);
  });

  it('is false when there is no profile row at all', () => {
    assert.equal(isPreTestReady(null), false);
    assert.equal(isPreTestReady(undefined), false);
  });

  it('accepts a date as a string as well as a Date', () => {
    assert.equal(isPreTestReady({ ...ready, dob: '2003-04-11' }), true);
  });
});

describe('isProfileCompleted', () => {
  const complete = {
    motherName: 'Lakshmi',
    fatherName: 'Ravi',
    dob: new Date('2003-04-11'),
    gender: 'FEMALE',
    photoUrl: 'https://s3/photo.jpg',
    aadhaarUrl: 'https://s3/aadhaar.pdf',
    panUrl: 'https://s3/pan.pdf',
  };

  it('needs photo, DOB, gender, Aadhaar and PAN', () => {
    assert.equal(isProfileCompleted(complete), true);
    for (const missing of ['photoUrl', 'dob', 'gender', 'aadhaarUrl', 'panUrl'] as const) {
      assert.equal(
        isProfileCompleted({ ...complete, [missing]: null }),
        false,
        `expected a missing ${missing} to leave the profile incomplete`,
      );
    }
  });

  it('counts documents an admin cannot see', () => {
    // The flag describes the student's record, not what one role may read.
    // Admins never see Aadhaar or PAN, and the profile is still incomplete
    // without them.
    assert.equal(isProfileCompleted({ ...complete, aadhaarUrl: null }), false);
  });

  it('does not depend on the pre-test fields alone', () => {
    const preTestOnly = {
      motherName: 'Lakshmi',
      fatherName: 'Ravi',
      dob: new Date('2003-04-11'),
    };
    assert.equal(isPreTestReady(preTestOnly), true);
    assert.equal(isProfileCompleted(preTestOnly), false);
  });
});

describe('admin student contracts — the privacy boundary', () => {
  const profile = {
    motherName: 'Lakshmi',
    fatherName: 'Ravi',
    dob: '2003-04-11',
    email: null,
    address: null,
    gender: 'FEMALE',
    photoUrl: null,
    educationDetails: null,
    pastExamHistory: null,
  };
  const detail = {
    id: 'stu_1',
    mobile: '9876543210',
    fullName: 'Asha',
    isActive: true,
    hasSignedIn: true,
    preTestReady: true,
    profileCompleted: false,
    groups: [{ id: 'g1', name: 'SSC Morning' }],
    createdAt: new Date().toISOString(),
    preferredLanguage: 'en',
    updatedAt: new Date().toISOString(),
    profile,
  };

  it('parses a well-formed detail', () => {
    assert.ok(studentDetailSchema.safeParse(detail).success);
  });

  it('STRIPS aadhaarUrl and panUrl even if a handler somehow supplies them', () => {
    // The contract is the enforcement: admins were scoped to everything except
    // the identity documents, so the response schema has no room for them and
    // zod drops them on the way out. A future careless `include: { profile:
    // true }` therefore cannot leak them.
    const leaky = {
      ...detail,
      profile: { ...profile, aadhaarUrl: 'https://s3/aadhaar.pdf', panUrl: 'https://s3/pan.pdf' },
    };

    const parsed = studentDetailSchema.parse(leaky);

    assert.ok(parsed.profile);
    assert.ok(!('aadhaarUrl' in parsed.profile), 'aadhaarUrl must not survive parsing');
    assert.ok(!('panUrl' in parsed.profile), 'panUrl must not survive parsing');
    assert.ok(!JSON.stringify(parsed).includes('aadhaar'));
  });

  it('never carries the PIN hash, only whether one exists', () => {
    const parsed = studentSummarySchema.parse({ ...detail, pinHash: '$argon2id$whatever' });

    assert.equal(parsed.hasSignedIn, true);
    assert.ok(!('pinHash' in parsed));
  });

  it('requires a summary to say which groups a student is in', () => {
    // Access is Student -> Group -> TestSeries -> Test, so a list that omits
    // groups cannot answer the question an admin opened it to ask.
    const { groups: _groups, ...withoutGroups } = detail;
    assert.equal(studentSummarySchema.safeParse(withoutGroups).success, false);
  });
});

describe('AppException use in the students module', () => {
  it('reports a duplicate mobile as CONFLICT with a field error', () => {
    // Shape check for what StudentsService.create throws: the admin form needs
    // the message on the mobile field, not in a banner.
    const error = new AppException(
      'CONFLICT' as never,
      'A student with that mobile number already exists',
      { fieldErrors: { mobile: ['Already registered'] } },
    );

    assert.equal(error.httpStatus, 409);
    assert.deepEqual(error.fieldErrors, { mobile: ['Already registered'] });
  });
});
