import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EVALUATION_MODE,
  PAPER_BINDING,
  TEST_BUILDER_STEP,
  allowedPaperBindings,
  createTestSchema,
  isPaperBindingAllowed,
  paperQuestionSchema,
  testBuilderStepOf,
  updateTestSchema,
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

describe('allowedPaperBindings', () => {
  /** The failure this prevents: a picker offering a choice, then the save refusing it. */
  it('leaves a ranked test only the frozen paper', () => {
    assert.deepEqual(allowedPaperBindings(EVALUATION_MODE.RANKED), [PAPER_BINDING.FIXED]);
  });

  it('leaves a practice test both', () => {
    assert.deepEqual(allowedPaperBindings(EVALUATION_MODE.PRACTICE), [
      PAPER_BINDING.FIXED,
      PAPER_BINDING.GENERATED,
    ]);
  });
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
      variant: 0,
      order: 1,
      marks: 2,
      negativeMarks: 0.5,
      status: 'ACTIVE',
    };
    assert.equal(paperQuestionSchema.safeParse(row).success, false);
    assert.equal(paperQuestionSchema.safeParse({ ...row, questionVersionId: 'v1' }).success, true);
  });
});

describe('a test is named when it is created', () => {
  /** The failure this prevents: 'Untitled test' in the header and 'this test' in every confirm. */
  it('refuses a create with no name', () => {
    assert.equal(createTestSchema.safeParse({ baseConfigId: 'cfg_1' }).success, false);
  });

  it('refuses a name of whitespace', () => {
    const parsed = createTestSchema.safeParse({ baseConfigId: 'cfg_1', title: '   ' });
    assert.equal(parsed.success, false);
  });

  it('accepts a named create', () => {
    const parsed = createTestSchema.safeParse({ baseConfigId: 'cfg_1', title: 'SSC CGL — Mock 1' });
    assert.equal(parsed.success, true);
  });

  /** An edit that is not about the name leaves it alone rather than sending it back. */
  it('lets an edit omit the name', () => {
    assert.equal(updateTestSchema.safeParse({ maxRetakes: 3 }).success, true);
  });

  /** The failure this prevents: a named test losing its name to a save that meant to keep it. */
  it('refuses an edit that clears the name', () => {
    assert.equal(updateTestSchema.safeParse({ title: null }).success, false);
  });
});

describe('testBuilderStepOf', () => {
  const draft = { isLocked: false, paperBinding: PAPER_BINDING.FIXED, paperQuestionCount: 0 };

  /** The failure this prevents: reopening a half-built test on a step with nothing left to do. */
  it('sends an undrawn fixed test to its paper', () => {
    assert.equal(testBuilderStepOf(draft), TEST_BUILDER_STEP.PAPER);
  });

  it('sends a drawn test on to offering it', () => {
    assert.equal(testBuilderStepOf({ ...draft, paperQuestionCount: 50 }), TEST_BUILDER_STEP.OFFER);
  });

  it('sends a finalized test on to offering it', () => {
    assert.equal(testBuilderStepOf({ ...draft, isLocked: true }), TEST_BUILDER_STEP.OFFER);
  });

  /** A generated test draws per attempt, so it has no paper step to owe work to. */
  it('sends a generated test past the paper', () => {
    assert.equal(
      testBuilderStepOf({ ...draft, paperBinding: PAPER_BINDING.GENERATED }),
      TEST_BUILDER_STEP.OFFER,
    );
  });
});
