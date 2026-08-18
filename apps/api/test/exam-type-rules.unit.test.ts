import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  examTypeDeletionBlocker,
  examTypeEditBlocker,
  type ExamTypeUsage,
} from '../src/configs/exam-type-rules';

const unused: ExamTypeUsage = {
  groupCount: 0,
  studentCount: 0,
  baseConfigCount: 0,
  testCount: 0,
};

describe('examTypeDeletionBlocker', () => {
  it('allows deleting an exam type nothing points at', () => {
    assert.equal(examTypeDeletionBlocker(unused), null);
  });

  /**
   * The failure this exists to prevent: `BaseConfig.examTypeId` CASCADEs and takes its sections
   * with it, so one delete destroys every blueprint under the exam type.
   */
  it('refuses one that still has base configs, and says how many', () => {
    const blocker = examTypeDeletionBlocker({ ...unused, baseConfigCount: 2 });
    assert.match(blocker ?? '', /2 base configs/);
  });

  /** `Test.examTypeId` and `Test.baseConfigId` both SET NULL — the tests survive, orphaned. */
  it('refuses one that still has tests', () => {
    assert.match(examTypeDeletionBlocker({ ...unused, testCount: 7 }) ?? '', /7 tests/);
  });

  it('names every holder at once, so the admin is not told one at a time', () => {
    const blocker =
      examTypeDeletionBlocker({
        groupCount: 3,
        studentCount: 40,
        baseConfigCount: 1,
        testCount: 0,
      }) ?? '';
    assert.match(blocker, /3 groups/);
    assert.match(blocker, /40 enrolled students/);
    assert.match(blocker, /1 base config\b/);
    assert.doesNotMatch(blocker, /0 tests/);
  });

  it('reads naturally for a single group', () => {
    assert.match(examTypeDeletionBlocker({ ...unused, groupCount: 1 }) ?? '', /1 group\b/);
  });

  it('offers retiring as the way out', () => {
    assert.match(examTypeDeletionBlocker({ ...unused, groupCount: 1 }) ?? '', /[Rr]etire/);
  });
});

describe('examTypeEditBlocker', () => {
  it('leaves a rename and a retire alone, however much is attached', () => {
    const busy: ExamTypeUsage = {
      groupCount: 9,
      studentCount: 400,
      baseConfigCount: 3,
      testCount: 12,
    };
    assert.equal(examTypeEditBlocker(busy, { name: 'SSC Combined Graduate Level' }), null);
    assert.equal(examTypeEditBlocker(busy, { isActive: false }), null);
    assert.equal(examTypeEditBlocker(busy, {}), null);
  });

  it('allows a code change while nothing references it', () => {
    assert.equal(
      examTypeEditBlocker({ ...unused, baseConfigCount: 4 }, { code: 'SSC CHSL' }),
      null,
    );
  });

  /**
   * CODE is stored as free text with no FK — changing it detaches every reference silently.
   */
  it('refuses a code change once groups carry it', () => {
    const blocker = examTypeEditBlocker({ ...unused, groupCount: 2 }, { code: 'SSC CHSL' });
    assert.match(blocker ?? '', /2 groups/);
    assert.match(blocker ?? '', /detach/);
  });

  it('refuses a code change once students are enrolled under it', () => {
    const blocker = examTypeEditBlocker({ ...unused, studentCount: 118 }, { code: 'SSC CHSL' });
    assert.match(blocker ?? '', /118 enrolled students/);
  });

  it('uses correct singular verb for a single group', () => {
    const blocker = examTypeEditBlocker({ ...unused, groupCount: 1 }, { code: 'SSC CHSL' });
    assert.match(blocker ?? '', /1 group already holds this code/);
  });

  it('uses correct singular verb for a single enrolled student', () => {
    const blocker = examTypeEditBlocker({ ...unused, studentCount: 1 }, { code: 'SSC CHSL' });
    assert.match(blocker ?? '', /1 enrolled student already holds this code/);
  });
});
