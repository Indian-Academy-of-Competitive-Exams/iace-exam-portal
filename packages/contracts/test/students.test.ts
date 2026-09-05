import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADMIN_STUDENT_ROUTES,
  STUDENT_TYPE,
  createStudentSchema,
  setStudentTestBlockedSchema,
  studentDetailSchema,
  studentListQuerySchema,
  studentSummarySchema,
  updateStudentSchema,
} from '../src/students';

const summary = {
  id: 'stu_1',
  mobile: '9876543210',
  fullName: 'Ravi Kumar',
  studentType: STUDENT_TYPE.OFFLINE,
  enrolledExams: ['SSC CGL'],
  enrolledCourses: [],
  isActive: true,
  isTestBlocked: false,
  hasSignedIn: true,
  hasDefaultPin: false,
  preTestReady: true,
  profileCompleted: false,
  createdAt: '2026-01-05T09:30:00.000Z',
};

const detail = {
  ...summary,
  programs: [],
  events: [],
  currentBranchId: null,
  updatedAt: '2026-01-05T09:30:00.000Z',
  profile: null,
};

describe('createStudentSchema — what a student is here for', () => {
  /**
   * The failure this prevents: a student created with no type at all, which is what the ONLINE
   * hardcode did to every student the admin screen and the sync path ever made. Type decides which
   * branch and which groups they may hold, so nothing may guess it.
   */
  it('refuses a student with no type', () => {
    const parsed = createStudentSchema.safeParse({ mobile: '9876543210' });

    assert.equal(parsed.success, false);
    assert.ok(parsed.error?.issues.some((issue) => issue.path[0] === 'studentType'));
  });

  it('takes enrolments, a programme and a branch alongside the type', () => {
    const parsed = createStudentSchema.parse({
      mobile: '9876543210',
      studentType: STUDENT_TYPE.OFFLINE,
      enrolledExams: ['SSC CGL', 'RRB JE'],
      programs: ['SSC CGL FOUNDATION'],
      currentBranchId: 'br_1',
    });

    assert.deepEqual(parsed.enrolledExams, ['SSC CGL', 'RRB JE']);
    assert.deepEqual(parsed.programs, ['SSC CGL FOUNDATION']);
    assert.equal(parsed.currentBranchId, 'br_1');
  });

  /**
   * The failure this prevents: the add-student form seeds its branch picker with '', so an admin who
   * leaves it alone would post an empty id. The service reads that as falsy, skips `assertUsable`,
   * and writes '' straight into the branch FK.
   */
  it('reads an untouched branch picker as absent, not as an empty branch id', () => {
    const parsed = createStudentSchema.parse({
      mobile: '9876543210',
      studentType: STUDENT_TYPE.ONLINE,
      currentBranchId: '',
    });

    assert.equal(parsed.currentBranchId, undefined);
  });

  it('leaves the programs absent when nobody named one', () => {
    const parsed = createStudentSchema.parse({
      mobile: '9876543210',
      studentType: STUDENT_TYPE.ONLINE,
    });

    assert.equal(parsed.programs, undefined);
  });
});

describe('updateStudentSchema — a patch, where a cleared box clears the field', () => {
  it('leaves an omitted key alone', () => {
    const parsed = updateStudentSchema.parse({});

    assert.equal(parsed.studentType, undefined);
    assert.equal(parsed.enrolledExams, undefined);
    assert.equal(parsed.programs, undefined);
    assert.equal(parsed.currentBranchId, undefined);
  });

  it('clears the branch when the box is emptied, and the programs when the list is', () => {
    const parsed = updateStudentSchema.parse({ programs: [], currentBranchId: '' });

    assert.deepEqual(parsed.programs, []);
    assert.equal(parsed.currentBranchId, null);
  });

  it('replaces the enrolments wholesale, including down to none', () => {
    assert.deepEqual(updateStudentSchema.parse({ enrolledExams: [] }).enrolledExams, []);
  });
});

describe('the roster reads both states', () => {
  it('carries studentType, enrolledExams and isTestBlocked on every row', () => {
    const parsed = studentSummarySchema.parse(summary);

    assert.equal(parsed.studentType, STUDENT_TYPE.OFFLINE);
    assert.deepEqual(parsed.enrolledExams, ['SSC CGL']);
    assert.equal(parsed.isTestBlocked, false);
  });

  /** Absent is "don't care"; false is a question the Status filter is allowed to ask. */
  it('tells an absent test-block filter apart from a false one', () => {
    assert.equal(studentListQuerySchema.parse({}).isTestBlocked, undefined);
    assert.equal(studentListQuerySchema.parse({ isTestBlocked: 'false' }).isTestBlocked, false);
    assert.equal(studentListQuerySchema.parse({ isTestBlocked: 'true' }).isTestBlocked, true);
  });

  it('refuses a summary missing studentType, enrolledExams or isTestBlocked', () => {
    const { studentType: _studentType, ...withoutType } = summary;
    assert.equal(studentSummarySchema.safeParse(withoutType).success, false);

    const { enrolledExams: _enrolledExams, ...withoutExams } = summary;
    assert.equal(studentSummarySchema.safeParse(withoutExams).success, false);

    const { isTestBlocked: _isTestBlocked, ...withoutBlocked } = summary;
    assert.equal(studentSummarySchema.safeParse(withoutBlocked).success, false);
  });
});

describe('studentDetailSchema — programs, events and branch are required keys', () => {
  it('accepts an empty list and a null branch — a known "none", not a gap', () => {
    assert.equal(studentDetailSchema.safeParse(detail).success, true);
  });

  it('refuses an absent key — "none" is a value on this schema, absent is not', () => {
    const { programs: _programs, ...withoutPrograms } = detail;
    assert.equal(studentDetailSchema.safeParse(withoutPrograms).success, false);

    const { events: _events, ...withoutEvents } = detail;
    assert.equal(studentDetailSchema.safeParse(withoutEvents).success, false);

    const { currentBranchId: _currentBranchId, ...withoutBranch } = detail;
    assert.equal(studentDetailSchema.safeParse(withoutBranch).success, false);
  });
});

describe('setStudentTestBlockedSchema', () => {
  it('is its own route and its own body, separate from sign-in', () => {
    assert.equal(
      ADMIN_STUDENT_ROUTES.setTestBlocked('stu_1'),
      '/admin/students/stu_1/test-blocked',
    );
    assert.notEqual(
      ADMIN_STUDENT_ROUTES.setTestBlocked('stu_1'),
      ADMIN_STUDENT_ROUTES.setActive('stu_1'),
    );
    assert.equal(setStudentTestBlockedSchema.parse({ isTestBlocked: true }).isTestBlocked, true);
    assert.equal(setStudentTestBlockedSchema.safeParse({}).success, false);
  });
});
