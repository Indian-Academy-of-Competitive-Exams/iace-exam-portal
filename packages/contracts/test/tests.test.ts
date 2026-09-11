import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EVALUATION_MODE,
  TEST_SCOPE,
  TEST_BUILDER_STEP,
  TEST_BUILDER_STEPS,
  createTestSchema,
  offerRequirements,
  scopedSections,
  scopedQuestionCount,
  scopedMarks,
  scopedDurationSec,
  seriesModeMismatch,
  testBuilderStepOf,
  owesAPaper,
  paperQuestionSchema,
  setPaperQuestionStatusSchema,
  DISPOSITION_REASON_MAX,
  PAPER_QUESTION_STATUS,
  updateTestSchema,
  type TestScope,
  type TestScopeRef,
} from '../src/index';

/** One sentence for both sides: the picker refuses the move in the server's own words. */
describe('seriesModeMismatch', () => {
  /** The failure this prevents: a confirm promising a move the server is about to refuse. */
  it('names both modes when a ranked test is offered a practice series', () => {
    const issue = seriesModeMismatch(
      'SSC CGL 2026 — Drills',
      EVALUATION_MODE.PRACTICE,
      EVALUATION_MODE.RANKED,
    );

    assert.ok(issue);
    assert.match(issue, /SSC CGL 2026 — Drills/);
    assert.match(issue, /Practice/);
    assert.match(issue, /Ranked/);
  });

  it('says nothing when the series judges the test the way it is judged', () => {
    assert.equal(
      seriesModeMismatch(
        'SSC CGL 2026 — Drills',
        EVALUATION_MODE.PRACTICE,
        EVALUATION_MODE.PRACTICE,
      ),
      null,
    );
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
    assert.equal(
      createTestSchema.safeParse({ baseConfigId: 'cfg_1', testSeriesId: 'srs_1' }).success,
      false,
    );
  });

  it('refuses a name of whitespace', () => {
    const parsed = createTestSchema.safeParse({
      baseConfigId: 'cfg_1',
      testSeriesId: 'srs_1',
      title: '   ',
    });
    assert.equal(parsed.success, false);
  });

  it('accepts a named create', () => {
    const parsed = createTestSchema.safeParse({
      baseConfigId: 'cfg_1',
      testSeriesId: 'srs_1',
      title: 'SSC CGL — Mock 1',
    });
    assert.equal(parsed.success, true);
  });

  /** A test reaches a student only through a series, and that series is what decides its mode. */
  it('refuses a create that names no series', () => {
    const parsed = createTestSchema.safeParse({
      baseConfigId: 'cfg_1',
      title: 'SSC CGL — Mock 1',
    });

    assert.equal(parsed.success, false);
    assert.deepEqual(parsed.error?.issues[0]?.path, ['testSeriesId']);
  });

  /** The failure this prevents: a PRACTICE series holding the RANKED test a client asked for. */
  it('drops an evaluation mode a client sends rather than judging it', () => {
    const parsed = createTestSchema.safeParse({
      baseConfigId: 'cfg_1',
      testSeriesId: 'srs_1',
      title: 'SSC CGL — Mock 1',
      evaluationMode: 'PRACTICE',
    });

    assert.equal(parsed.success, true);
    assert.equal('evaluationMode' in (parsed.data ?? {}), false);
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
  const built = {
    isLocked: false,
    paperQuestionCount: 100,
    totalQuestions: 100,
  };
  const met = (test: Parameters<typeof offerRequirements>[0]) =>
    offerRequirements(test).map((requirement) => requirement.met);

  /** A test is created inside a series and cannot leave, so the paper is all that is left to owe. */
  it('is ready when the paper is whole', () => {
    assert.deepEqual(met(built), [true]);
  });

  /** The failure this prevents: offering a half-picked paper and finding out at the freeze. */
  it('is not ready while the paper is short, and says how far', () => {
    const [paper] = offerRequirements({ ...built, paperQuestionCount: 64 });

    assert.equal(paper?.met, false);
    assert.equal(paper?.owed, '64 chosen so far');
  });

  /** A frozen paper is whole by definition — a retired test must be offerable again. */
  it('takes a frozen paper as whole however its rows are counted', () => {
    assert.deepEqual(met({ ...built, isLocked: true, paperQuestionCount: 0 }), [true]);
  });
});

describe('testBuilderStepOf', () => {
  const built = {
    isLocked: false,
    paperQuestionCount: 100,
    totalQuestions: 100,
  };

  /** THE failure this prevents: reopening a half-built paper and landing past it, on Offer. */
  it('lands on the paper while it is part built, not only while it is empty', () => {
    assert.equal(testBuilderStepOf({ ...built, paperQuestionCount: 40 }), TEST_BUILDER_STEP.PAPER);
    assert.equal(testBuilderStepOf({ ...built, paperQuestionCount: 0 }), TEST_BUILDER_STEP.PAPER);
  });

  it('lands on offer once the paper is whole', () => {
    assert.equal(testBuilderStepOf(built), TEST_BUILDER_STEP.OFFER);
  });

  /** A frozen paper cannot be built further, so there is nothing on that step to send them to. */
  it('lands on offer for a frozen test, however few questions it counted', () => {
    assert.equal(
      testBuilderStepOf({ ...built, isLocked: true, paperQuestionCount: 0 }),
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

describe('scopedDurationSec', () => {
  const timed = [
    { id: 'sec_a', moduleId: 'mod_a', questionCount: 40, durationSec: 2100, perQuestionSec: null },
    { id: 'sec_b', moduleId: 'mod_a', questionCount: 40, durationSec: 2100, perQuestionSec: null },
    { id: 'sec_c', moduleId: 'mod_b', questionCount: 35, durationSec: 2700, perQuestionSec: null },
  ];
  const composite = [
    { id: 'sec_a', moduleId: null, questionCount: 25, durationSec: null, perQuestionSec: null },
    { id: 'sec_b', moduleId: null, questionCount: 75, durationSec: null, perQuestionSec: null },
  ];
  const config = { durationSec: 3600, totalQuestions: 100 };

  /** A whole paper is untouched: the configuration's clock is the clock, whatever the sections say. */
  it('leaves a full paper on the configuration clock', () => {
    assert.equal(
      scopedDurationSec(timed, { durationSec: 6900, totalQuestions: 115 }, TEST_SCOPE.FULL, null),
      6900,
    );
  });

  /** THE failure this prevents: a 35-minute section sat for the whole paper's hour. */
  it('gives a sectional test its own section clock', () => {
    assert.equal(
      scopedDurationSec(timed, { durationSec: 6900, totalQuestions: 115 }, TEST_SCOPE.SECTIONAL, {
        sectionId: 'sec_c',
      }),
      2700,
    );
  });

  it('sums the sections a module covers', () => {
    assert.equal(
      scopedDurationSec(timed, { durationSec: 6900, totalQuestions: 115 }, TEST_SCOPE.MODULE, {
        moduleId: 'mod_a',
      }),
      4200,
    );
  });

  /** A composite paper has one clock for all of it, so a section's share is the honest answer. */
  it('takes a share of a composite clock, rounded to the minute', () => {
    assert.equal(
      scopedDurationSec(composite, config, TEST_SCOPE.SECTIONAL, { sectionId: 'sec_a' }),
      900,
    );
    assert.equal(
      scopedDurationSec(composite, config, TEST_SCOPE.SECTIONAL, { sectionId: 'sec_b' }),
      2700,
    );
  });

  /** Seconds per question is the per-section clock a composite paper CAN carry, so it wins the share. */
  it('prefers seconds per question over a share when the section names one', () => {
    const paced = composite.map((section) => ({ ...section, perQuestionSec: 90 }));

    assert.equal(
      scopedDurationSec(paced, config, TEST_SCOPE.SECTIONAL, { sectionId: 'sec_a' }),
      2250,
    );
  });

  /** Nothing to go on is the configuration's clock, never zero — a test with no time cannot be sat. */
  it('falls back to the configuration clock rather than to nothing', () => {
    assert.equal(
      scopedDurationSec(composite, { durationSec: 3600, totalQuestions: 0 }, TEST_SCOPE.SECTIONAL, {
        sectionId: 'sec_a',
      }),
      3600,
    );
    assert.equal(
      scopedDurationSec(composite, config, TEST_SCOPE.SECTIONAL, { sectionId: 'sec_gone' }),
      3600,
    );
  });
});

describe('owesAPaper', () => {
  const built = {
    isLocked: false,
    paperQuestionCount: 100,
    totalQuestions: 100,
  };

  /** THE failure this prevents: a finished paper whose step never ticks, so it reads as outstanding. */
  it('owes nothing once every question is on the paper', () => {
    assert.equal(owesAPaper(built), false);
  });

  it('owes a paper while it is part built', () => {
    assert.equal(owesAPaper({ ...built, paperQuestionCount: 40 }), true);
  });

  /** The tick and the landing step are one rule, so they cannot say different things. */
  it('is the same answer the landing step reads', () => {
    const half = { ...built, paperQuestionCount: 40 };

    assert.equal(testBuilderStepOf(half), TEST_BUILDER_STEP.PAPER);
    assert.equal(owesAPaper(half), true);
    assert.equal(testBuilderStepOf(built), TEST_BUILDER_STEP.OFFER);
    assert.equal(owesAPaper(built), false);
  });
});

describe('what a disposition change has to say for itself', () => {
  const dropped = { status: PAPER_QUESTION_STATUS.DROPPED };

  /** THE failure this prevents: published ranks moving with an audit row that cannot say why. */
  it('refuses a change with no reason at all', () => {
    assert.equal(setPaperQuestionStatusSchema.safeParse(dropped).success, false);
  });

  it('refuses a reason that is only whitespace', () => {
    assert.equal(
      setPaperQuestionStatusSchema.safeParse({ ...dropped, reason: '   ' }).success,
      false,
    );
  });

  it('trims the reason it keeps, so the audit row holds the words and not the padding', () => {
    assert.deepEqual(setPaperQuestionStatusSchema.parse({ ...dropped, reason: '  key wrong  ' }), {
      status: PAPER_QUESTION_STATUS.DROPPED,
      reason: 'key wrong',
    });
  });

  it('refuses a reason longer than the column takes', () => {
    const tooLong = 'x'.repeat(DISPOSITION_REASON_MAX + 1);

    assert.equal(
      setPaperQuestionStatusSchema.safeParse({ ...dropped, reason: tooLong }).success,
      false,
    );
  });
});
