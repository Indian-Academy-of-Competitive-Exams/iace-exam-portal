import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ownDetailsMoved, updateMeSchema, type Me } from '../src/me';

/** A student patches their own record with no id in the path, so this schema is the only thing standing between them and the fields that decide what they can reach. */
describe('updateMeSchema', () => {
  it('keeps the fields a student owns', () => {
    const parsed = updateMeSchema.parse({
      fullName: 'Asha Rao',
      profile: { motherName: 'Lakshmi' },
    });

    assert.equal(parsed.fullName, 'Asha Rao');
    assert.equal(parsed.profile?.motherName, 'Lakshmi');
  });

  /** Regression guard: an enrolment reaches every EXAM and PROGRAM group for that code, so a student who could set their own would grant themselves the whole series. */
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

const ME: Me = {
  id: 'stu_1',
  mobile: '9876543210',
  fullName: 'Asha',
  studentType: 'OFFLINE',
  enrolledExams: [],
  enrolledCourses: [],
  programs: [],
  hasOwnAccess: false,
  isActive: true,
  isTestBlocked: false,
  preTestReady: false,
  profileCompleted: false,
  createdAt: '2026-10-01T04:00:00.000Z',
  events: [],
  formerMobiles: [],
  currentBranchId: null,
  updatedAt: '2026-10-01T04:00:00.000Z',
  profile: null,
  enrolment: { programs: [], exams: [], branch: null },
};

const withProfile = (over: Partial<NonNullable<Me['profile']>>): Me['profile'] => ({
  motherName: null,
  fatherName: null,
  dob: null,
  email: null,
  address: null,
  gender: null,
  photoUrl: null,
  aadhaarVerified: false,
  panVerified: false,
  tenthMarksheetUrl: null,
  educationDetails: null,
  pastExamHistory: null,
  ...over,
});

/** A student's save goes out on the newest stamp only while this names nothing, so it decides what is refused. */
describe('ownDetailsMoved', () => {
  it('names each field the student writes that differs between the two reads', () => {
    const latest = {
      ...ME,
      fullName: 'Asha Rani',
      profile: withProfile({
        fatherName: 'Ravi',
        educationDetails: [{ level: 'Class 12', year: 2022, percentage: 81 }],
      }),
    };

    assert.deepEqual(ownDetailsMoved(ME, latest), ['Full name', "Father's name", 'Education']);
  });

  /** The failure this prevents: a save refused for ever because an enrolment, a block or an upload moved the record. */
  it('names nothing for what the student cannot write, an empty profile row, or no edit to measure', () => {
    const elsewhere = {
      ...ME,
      enrolledExams: ['SSC CGL'],
      isTestBlocked: true,
      updatedAt: '2026-10-01T04:05:00.000Z',
      profile: withProfile({ photoUrl: 'https://signed.local/photo', aadhaarVerified: true }),
    };

    assert.deepEqual(ownDetailsMoved(ME, elsewhere), []);
    assert.deepEqual(ownDetailsMoved(null, elsewhere), []);
    assert.deepEqual(ownDetailsMoved(ME, undefined), []);
  });
});
