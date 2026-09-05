import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EVALUATION_MODE,
  PAPER_BINDING,
  TEST_SCOPE,
  TEST_BUILDER_STEP,
  TEST_BUILDER_STEPS,
  allowedPaperBindings,
  createTestSchema,
  isPaperBindingAllowed,
  offerRequirements,
  scopedSections,
  scopedQuestionCount,
  scopedMarks,
  testBuilderStepOf,
  paperQuestionSchema,
  updateTestSchema,
  type TestScope,
  type TestScopeRef,
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

describe('TEST_BUILDER_STEP', () => {
  /** The order is the walk: the footer and the stepper both read the steps straight off it. */
  it('walks Setup, then Paper, then Offer', () => {
    assert.deepEqual(TEST_BUILDER_STEPS, [
      TEST_BUILDER_STEP.SETUP,
      TEST_BUILDER_STEP.PAPER,
      TEST_BUILDER_STEP.OFFER,
    ]);
  });
});

describe('offerRequirements', () => {
  const fixed = {
    isLocked: false,
    paperBinding: PAPER_BINDING.FIXED,
    paperQuestionCount: 100,
    totalQuestions: 100,
    testSeriesId: 'srs_1',
    variantCount: 1,
  };
  const met = (test: Parameters<typeof offerRequirements>[0]) =>
    offerRequirements(test).map((requirement) => requirement.met);

  it('is ready when the paper is whole and a series carries it', () => {
    assert.deepEqual(met(fixed), [true, true]);
  });

  /** The failure this prevents: offering a half-picked paper and finding out at the freeze. */
  it('is not ready while the paper is short, and says how far', () => {
    const [paper] = offerRequirements({ ...fixed, paperQuestionCount: 64 });

    assert.equal(paper?.met, false);
    assert.equal(paper?.owed, '64 chosen so far');
  });

  it('is not ready while no series carries it', () => {
    assert.deepEqual(met({ ...fixed, testSeriesId: null }), [true, false]);
  });

  /** A frozen paper is whole by definition — a retired test must be offerable again. */
  it('takes a frozen paper as whole however its rows are counted', () => {
    assert.deepEqual(met({ ...fixed, isLocked: true, paperQuestionCount: 0 }), [true, true]);
  });

  /** A generated test has no paper to check: the draw happens at the freeze, not before it. */
  it('asks a generated test for nothing but a series', () => {
    const generated = { ...fixed, paperBinding: PAPER_BINDING.GENERATED, paperQuestionCount: 0 };

    assert.deepEqual(met(generated), [true, true]);
    assert.deepEqual(met({ ...generated, testSeriesId: null }), [true, false]);
  });
});

describe('testBuilderStepOf', () => {
  const fixed = {
    isLocked: false,
    paperBinding: PAPER_BINDING.FIXED,
    paperQuestionCount: 100,
    totalQuestions: 100,
    testSeriesId: 'srs_1',
    variantCount: 1,
  };

  /** THE failure this prevents: reopening a half-built paper and landing past it, on Offer. */
  it('lands on the paper while it is part built, not only while it is empty', () => {
    assert.equal(testBuilderStepOf({ ...fixed, paperQuestionCount: 40 }), TEST_BUILDER_STEP.PAPER);
    assert.equal(testBuilderStepOf({ ...fixed, paperQuestionCount: 0 }), TEST_BUILDER_STEP.PAPER);
  });

  it('lands on offer once the paper is whole', () => {
    assert.equal(testBuilderStepOf(fixed), TEST_BUILDER_STEP.OFFER);
  });

  /** A frozen paper cannot be built further, so there is nothing on that step to send them to. */
  it('lands on offer for a frozen test, however few questions it counted', () => {
    assert.equal(
      testBuilderStepOf({ ...fixed, isLocked: true, paperQuestionCount: 0 }),
      TEST_BUILDER_STEP.OFFER,
    );
  });

  /** A drawn test owes no paper before it is offered — the draw is what makes one. */
  it('lands on offer for a test that draws its own papers', () => {
    assert.equal(
      testBuilderStepOf({
        ...fixed,
        paperBinding: PAPER_BINDING.GENERATED,
        paperQuestionCount: 0,
        variantCount: 10,
      }),
      TEST_BUILDER_STEP.OFFER,
    );
  });
});

describe('scopedSections', () => {
  const sections = [
    { id: 'sec_quant', moduleId: 'mod_a', questionCount: 25 },
    { id: 'sec_reasoning', moduleId: 'mod_a', questionCount: 25 },
    { id: 'sec_english', moduleId: 'mod_b', questionCount: 25 },
    { id: 'sec_gk', moduleId: null, questionCount: 25 },
  ];
  const ids = (scope: TestScope, ref: TestScopeRef | null) =>
    scopedSections(sections, scope, ref).map((section) => section.id);

  it('puts every section in play for a full paper', () => {
    assert.deepEqual(ids(TEST_SCOPE.FULL, null), [
      'sec_quant',
      'sec_reasoning',
      'sec_english',
      'sec_gk',
    ]);
  });

  /** THE failure this prevents: a sectional test whose paper can be built across every section. */
  it('holds a sectional test to the one section it names', () => {
    assert.deepEqual(ids(TEST_SCOPE.SECTIONAL, { sectionId: 'sec_english' }), ['sec_english']);
  });

  it('holds a module test to that module, and a section outside it stays out', () => {
    assert.deepEqual(ids(TEST_SCOPE.MODULE, { moduleId: 'mod_a' }), ['sec_quant', 'sec_reasoning']);
  });

  /** A scope naming nothing covers nothing, rather than quietly falling back to everything. */
  it('covers nothing when the reference names nothing it holds', () => {
    assert.deepEqual(ids(TEST_SCOPE.SECTIONAL, null), []);
    assert.deepEqual(ids(TEST_SCOPE.SECTIONAL, { sectionId: 'sec_gone' }), []);
    assert.deepEqual(ids(TEST_SCOPE.MODULE, { moduleId: 'mod_gone' }), []);
  });

  /** A null moduleId is a section belonging to no module, not one matching every module. */
  it('does not sweep a module-less section into a module test', () => {
    assert.deepEqual(ids(TEST_SCOPE.MODULE, {}), []);
  });
});

describe('scopedQuestionCount', () => {
  const sections = [
    { id: 'sec_quant', moduleId: 'mod_a', questionCount: 25 },
    { id: 'sec_reasoning', moduleId: 'mod_a', questionCount: 30 },
    { id: 'sec_english', moduleId: 'mod_b', questionCount: 20 },
  ];

  it('counts the whole configuration for a full paper', () => {
    assert.equal(scopedQuestionCount(sections, TEST_SCOPE.FULL, null), 75);
  });

  /** THE failure this prevents: a correctly built sectional paper that can never be offered. */
  it('counts only what a sectional test covers', () => {
    assert.equal(
      scopedQuestionCount(sections, TEST_SCOPE.SECTIONAL, { sectionId: 'sec_english' }),
      20,
    );
  });

  it('counts a module as the sum of its own sections', () => {
    assert.equal(scopedQuestionCount(sections, TEST_SCOPE.MODULE, { moduleId: 'mod_a' }), 55);
  });
});

describe('scopedMarks', () => {
  const sections = [
    { id: 'sec_quant', moduleId: 'mod_a', questionCount: 25, marksPerQuestion: 2 },
    { id: 'sec_english', moduleId: 'mod_b', questionCount: 20, marksPerQuestion: 1 },
  ];

  /** Marks are PER SECTION, so a scoped paper is not a fraction of the configuration's total. */
  it('is worth what its own sections are worth, at their own rates', () => {
    assert.equal(scopedMarks(sections, TEST_SCOPE.FULL, null), 70);
    assert.equal(scopedMarks(sections, TEST_SCOPE.SECTIONAL, { sectionId: 'sec_english' }), 20);
    assert.equal(scopedMarks(sections, TEST_SCOPE.SECTIONAL, { sectionId: 'sec_quant' }), 50);
  });
});
