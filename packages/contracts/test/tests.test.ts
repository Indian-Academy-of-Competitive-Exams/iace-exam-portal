import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EVALUATION_MODE,
  PAPER_BINDING,
  isPaperBindingAllowed,
  paperQuestionSchema,
} from '../src/index';

/**
 * The same rule the database holds as a CHECK on Test. It lives here too because a form
 * should refuse the combination before a request is made, and both sides must agree on
 * which combination that is.
 */
describe('isPaperBindingAllowed', () => {
  /** The failure this prevents: a leaderboard ranking students who sat different papers. */
  it('refuses a ranked test drawn per attempt', () => {
    assert.equal(isPaperBindingAllowed(EVALUATION_MODE.RANKED, PAPER_BINDING.GENERATED), false);
  });

  it('allows a ranked test on a frozen paper', () => {
    assert.equal(isPaperBindingAllowed(EVALUATION_MODE.RANKED, PAPER_BINDING.FIXED), true);
  });

  /** Practice never ranks, so either paper is fine. */
  for (const binding of [PAPER_BINDING.FIXED, PAPER_BINDING.GENERATED]) {
    it(`allows a practice test on a ${binding.toLowerCase()} paper`, () => {
      assert.equal(isPaperBindingAllowed(EVALUATION_MODE.PRACTICE, binding), true);
    });
  }
});

describe('paperQuestionSchema', () => {
  /** A paper row pins a version, which is what makes a past result reproducible. */
  it('requires the version the paper serves', () => {
    const row = {
      id: 'pq1',
      testId: 't1',
      baseConfigSectionId: 'sec1',
      baseConfigId: 'c1',
      questionId: 'q1',
      order: 1,
      marks: 2,
      negativeMarks: 0.5,
      status: 'ACTIVE',
    };
    assert.equal(paperQuestionSchema.safeParse(row).success, false);
    assert.equal(paperQuestionSchema.safeParse({ ...row, questionVersionId: 'v1' }).success, true);
  });
});
