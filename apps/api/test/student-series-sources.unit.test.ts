import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EXAM_FAMILY, STUDENT_SERIES_SOURCE, TEST_SERIES_KIND } from '@iace/contracts';
import { seriesSources } from '../src/access/student-grants.service';

const student = {
  programs: ['FOUNDATION'],
  enrolledExams: ['SSC CGL'],
  enrolledFamilies: [EXAM_FAMILY.SSC],
};

describe('seriesSources — why a student reaches a series', () => {
  it('reads an untagged series the student is enrolled for as an exam match', () => {
    const sources = seriesSources(
      {
        programCode: null,
        examCode: 'SSC CGL',
        granted: false,
        enabledAtBranch: true,
        examFamily: EXAM_FAMILY.SSC,
        kind: TEST_SERIES_KIND.STANDARD,
      },
      student,
    );

    assert.deepEqual(sources, [STUDENT_SERIES_SOURCE.EXAM]);
  });

  it('reads a series tagged with a program the student holds as a program match', () => {
    const sources = seriesSources(
      {
        programCode: 'FOUNDATION',
        examCode: 'SSC CGL',
        granted: false,
        enabledAtBranch: true,
        examFamily: EXAM_FAMILY.SSC,
        kind: TEST_SERIES_KIND.STANDARD,
      },
      student,
    );

    assert.deepEqual(sources, [STUDENT_SERIES_SOURCE.PROGRAM]);
  });

  /** Credit the enrolment here and the revoke confirm promises access that only the grant holds. */
  it('never credits an exam enrolment for a series tagged with a program they lack', () => {
    const sources = seriesSources(
      {
        programCode: 'CRASH_COURSE',
        examCode: 'SSC CGL',
        granted: false,
        enabledAtBranch: true,
        examFamily: EXAM_FAMILY.SSC,
        kind: TEST_SERIES_KIND.STANDARD,
      },
      student,
    );

    assert.deepEqual(sources, []);
  });

  it('names the grant as well as the program when both reach it', () => {
    const sources = seriesSources(
      {
        programCode: 'FOUNDATION',
        examCode: 'SSC CGL',
        granted: true,
        enabledAtBranch: true,
        examFamily: EXAM_FAMILY.SSC,
        kind: TEST_SERIES_KIND.STANDARD,
      },
      student,
    );

    assert.deepEqual(sources, [STUDENT_SERIES_SOURCE.PROGRAM, STUDENT_SERIES_SOURCE.GRANT]);
  });

  /** The grant now outranks the branch switch, so what the branch refuses is not "reached by program". */
  it('does not credit a program the branch has switched the series off for', () => {
    const sources = seriesSources(
      {
        programCode: 'FOUNDATION',
        examCode: 'SSC CGL',
        granted: true,
        enabledAtBranch: false,
        examFamily: EXAM_FAMILY.SSC,
        kind: TEST_SERIES_KIND.STANDARD,
      },
      student,
    );

    assert.deepEqual(sources, [STUDENT_SERIES_SOURCE.GRANT]);
  });

  it('names the grant alone when nothing automatic reaches it', () => {
    const sources = seriesSources(
      {
        programCode: null,
        examCode: 'RRB JE',
        granted: true,
        enabledAtBranch: true,
        examFamily: EXAM_FAMILY.SSC,
        kind: TEST_SERIES_KIND.STANDARD,
      },
      student,
    );

    assert.deepEqual(sources, [STUDENT_SERIES_SOURCE.GRANT]);
  });

  /** The family arm is FREE-only: a standard series on the same family opens for nobody. */
  it('opens a FREE series on an enrolled family, and a standard one on the same family never', () => {
    const free = seriesSources(
      {
        programCode: null,
        examCode: 'RRB JE',
        examFamily: EXAM_FAMILY.SSC,
        kind: TEST_SERIES_KIND.FREE,
        granted: false,
        enabledAtBranch: true,
      },
      student,
    );
    const standard = seriesSources(
      {
        programCode: null,
        examCode: 'RRB JE',
        examFamily: EXAM_FAMILY.SSC,
        kind: TEST_SERIES_KIND.STANDARD,
        granted: false,
        enabledAtBranch: true,
      },
      student,
    );

    assert.deepEqual(free, [STUDENT_SERIES_SOURCE.FAMILY]);
    assert.deepEqual(standard, []);
  });
});
