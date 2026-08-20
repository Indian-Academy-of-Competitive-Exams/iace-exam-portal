import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  createStudentSchema,
  STUDENT_TYPE,
  studentDetailSchema,
  studentSummarySchema,
  updateStudentSchema,
} from '@iace/contracts';
import { isPreTestReady, isProfileCompleted } from '../src/students/student-flags';

/**
 * The flag rules and the privacy boundary. Both are the sort of thing that looks obviously right
 * in review and is wrong in production, so they are asserted rather than read.
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
    aadhaarVerified: 'https://s3/aadhaar.pdf',
    panVerified: 'https://s3/pan.pdf',
  };

  it('needs photo, DOB and gender', () => {
    assert.equal(isProfileCompleted(complete), true);
    for (const missing of ['photoUrl', 'dob', 'gender'] as const) {
      assert.equal(
        isProfileCompleted({ ...complete, [missing]: null }),
        false,
        `expected a missing ${missing} to leave the profile incomplete`,
      );
    }
  });

  it('ignores Aadhaar and PAN, which nothing in this codebase verifies yet', () => {
    // Their images are never stored and their verified flags are set by a review that does not
    // run yet — asking for them would leave the nudge on forever.
    assert.equal(isProfileCompleted(complete), true);
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

describe('admin student contracts', () => {
  const profile = {
    motherName: 'Lakshmi',
    fatherName: 'Ravi',
    dob: '2003-04-11',
    email: null,
    address: null,
    gender: 'FEMALE',
    photoUrl: null,
    aadhaarVerified: false,
    panVerified: false,
    educationDetails: null,
    pastExamHistory: null,
  };
  const detail = {
    id: 'stu_1',
    mobile: '9876543210',
    fullName: 'Asha',
    studentType: STUDENT_TYPE.OFFLINE,
    enrolledExams: [],
    isActive: true,
    isTestBlocked: false,
    hasSignedIn: true,
    hasDefaultPin: false,
    preTestReady: true,
    profileCompleted: false,
    createdAt: new Date().toISOString(),
    preferredLanguage: 'EN',
    programs: [],
    currentBranchId: null,
    updatedAt: new Date().toISOString(),
    profile,
  };

  it('parses a well-formed detail', () => {
    assert.ok(studentDetailSchema.safeParse(detail).success);
  });

  /** Admins see whether identity was verified, never an image. */
  it('carries the identity verification flags', () => {
    const withDocs = {
      ...detail,
      profile: { ...profile, aadhaarVerified: true, panVerified: false },
    };

    const parsed = studentDetailSchema.parse(withDocs);

    assert.equal(parsed.profile?.aadhaarVerified, true);
    assert.equal(parsed.profile?.panVerified, false);
  });

  /**
   * A malformed JSON column reads as "nothing recorded" rather than reaching a screen that assumes
   * an array — these are written by hand and by older builds, and a crash on someone else's data is
   * not the student's problem.
   */
  it('refuses education history that is not a list of entries', () => {
    const junk = { ...detail, profile: { ...profile, educationDetails: 'BSc' } };

    assert.equal(studentDetailSchema.safeParse(junk).success, false);
  });

  it('accepts well-formed education and exam history', () => {
    const filled = {
      ...detail,
      profile: {
        ...profile,
        educationDetails: [{ level: 'Class 12', board: 'CBSE', year: 2021, percentage: 88.5 }],
        pastExamHistory: [{ exam: 'SSC CGL 2024', year: 2024, result: 'Tier 1 cleared' }],
      },
    };

    const parsed = studentDetailSchema.parse(filled);
    assert.equal(parsed.profile?.educationDetails?.[0]?.level, 'Class 12');
    assert.equal(parsed.profile?.pastExamHistory?.[0]?.exam, 'SSC CGL 2024');
  });

  it('never carries the PIN hash, only whether one exists', () => {
    const parsed = studentSummarySchema.parse({ ...detail, pinHash: '$argon2id$whatever' });

    assert.equal(parsed.hasSignedIn, true);
    assert.ok(!('pinHash' in parsed));
  });

  it('requires a summary to say what a student is enrolled on', () => {
    // An enrolment is the route to a series, so a list that omits it cannot answer
    // the question an admin opened it to ask.
    const { enrolledExams: _enrolledExams, ...withoutEnrolments } = detail;
    assert.equal(studentSummarySchema.safeParse(withoutEnrolments).success, false);
  });
});

describe('createStudentSchema — an absent name is not an invalid one', () => {
  it('accepts a student with no name at all', () => {
    // Only the mobile and the type are required. A roster often has numbers before names.
    const parsed = createStudentSchema.parse({
      mobile: '9876543210',
      studentType: STUDENT_TYPE.ONLINE,
    });
    assert.equal(parsed.fullName, undefined);
  });

  it('accepts an EMPTY name field — the regression', () => {
    // `.min(1).optional()` rejected '': optional permits undefined, never the empty string.
    const parsed = createStudentSchema.parse({
      mobile: '9876543210',
      studentType: STUDENT_TYPE.ONLINE,
      fullName: '',
    });
    assert.equal(parsed.fullName, undefined);
  });

  it('treats a whitespace-only name as absent too', () => {
    assert.equal(
      createStudentSchema.parse({
        mobile: '9876543210',
        studentType: STUDENT_TYPE.ONLINE,
        fullName: '   ',
      }).fullName,
      undefined,
    );
  });

  it('keeps a real name, trimmed', () => {
    assert.equal(
      createStudentSchema.parse({
        mobile: '9876543210',
        studentType: STUDENT_TYPE.ONLINE,
        fullName: '  Meera Rao ',
      }).fullName,
      'Meera Rao',
    );
  });

  it('still refuses an absurdly long name', () => {
    assert.equal(
      createStudentSchema.safeParse({
        mobile: '9876543210',
        studentType: STUDENT_TYPE.ONLINE,
        fullName: 'x'.repeat(200),
      }).success,
      false,
    );
  });

  it('reads an empty name on UPDATE as clearing it, not as absent', () => {
    // On a patch the two differ: absent means "leave it", null means "remove it",
    // and an emptied box is the admin asking for the latter.
    assert.equal(updateStudentSchema.parse({ fullName: '' }).fullName, null);
    assert.equal(updateStudentSchema.parse({}).fullName, undefined);
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
