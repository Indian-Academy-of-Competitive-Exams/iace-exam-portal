import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EXAM_COURSE, STUDENT_SERIES_SOURCE, TEST_SERIES_KIND } from '@iace/contracts';
import { seriesSources } from '../src/access/student-grants.service';

const student = {
  currentBranchId: 'br_1',
  programs: ['FOUNDATION'],
  enrolledCourses: [EXAM_COURSE.SSC],
};

const series = (over: Partial<Parameters<typeof seriesSources>[0]['series']> = {}) => ({
  kind: TEST_SERIES_KIND.STANDARD,
  programCode: null,
  course: EXAM_COURSE.SSC,
  branchIds: ['br_1'],
  granted: false,
  isCandidate: false,
  ...over,
});

describe('seriesSources — why a student reaches a series', () => {
  it('reads a standard series at their branch, in a course they carry, as a course match', () => {
    assert.deepEqual(seriesSources({ series: series(), student }), [STUDENT_SERIES_SOURCE.COURSE]);
  });

  it('refuses the course match when the series is not switched on at their branch', () => {
    const sources = seriesSources({ series: series({ branchIds: ['br_2'] }), student });

    assert.deepEqual(sources, []);
  });

  it('refuses the course match when they are enrolled for a different course', () => {
    const sources = seriesSources({
      series: series({ course: EXAM_COURSE.BANKING }),
      student,
    });

    assert.deepEqual(sources, []);
  });

  it('reads a free series as reaching everyone, branch and course notwithstanding', () => {
    const sources = seriesSources({
      series: series({ kind: TEST_SERIES_KIND.FREE, course: null, branchIds: [] }),
      student,
    });

    assert.deepEqual(sources, [STUDENT_SERIES_SOURCE.FREE]);
  });

  it('reads a program series the student carries as a program match', () => {
    const sources = seriesSources({
      series: series({ kind: TEST_SERIES_KIND.PROGRAM, programCode: 'FOUNDATION' }),
      student,
    });

    assert.deepEqual(sources, [STUDENT_SERIES_SOURCE.PROGRAM]);
  });

  /** Credit the course here and the revoke confirm promises access that only the grant holds. */
  it('never credits a course for a program series the student does not carry', () => {
    const sources = seriesSources({
      series: series({ kind: TEST_SERIES_KIND.PROGRAM, programCode: 'CRASH_COURSE' }),
      student,
    });

    assert.deepEqual(sources, []);
  });

  it('reads an event series as reached only by being one of its candidates', () => {
    const event = { kind: TEST_SERIES_KIND.EVENT, branchIds: [], isCandidate: true };

    assert.deepEqual(seriesSources({ series: series(event), student }), [
      STUDENT_SERIES_SOURCE.EVENT,
    ]);
    assert.deepEqual(
      seriesSources({ series: series({ ...event, isCandidate: false }), student }),
      [],
    );
  });

  it('names the grant as well as the program when both reach it', () => {
    const sources = seriesSources({
      series: series({
        kind: TEST_SERIES_KIND.PROGRAM,
        programCode: 'FOUNDATION',
        granted: true,
      }),
      student,
    });

    assert.deepEqual(sources, [STUDENT_SERIES_SOURCE.PROGRAM, STUDENT_SERIES_SOURCE.GRANT]);
  });

  it('names the grant alone when nothing automatic reaches it', () => {
    const sources = seriesSources({ series: series({ branchIds: [], granted: true }), student });

    assert.deepEqual(sources, [STUDENT_SERIES_SOURCE.GRANT]);
  });
});
