import {
  AppException,
  DEFAULT_PAPER_VARIANTS,
  ErrorCodes,
  MIN_PAPER_VARIANTS,
  seriesModeMismatch,
  isPaperBindingAllowed,
  PAPER_BINDING,
  TEST_SCOPE,
  TEST_STATUS,
  type EvaluationMode,
  type PaperBinding,
  type TestScope,
  type TestScopeRef,
  type UpdateTestBody,
} from '@iace/contracts';

/** The rules that keep a test honest — pure, so they are testable without a database. */

/** What a test is when the admin says nothing. The mode is absent: its series decides that. */
export const TEST_DEFAULTS = {
  scope: TEST_SCOPE.FULL,
  paperBinding: PAPER_BINDING.FIXED,
} as const;

export const RANKED_NEEDS_FIXED_MESSAGE =
  'A ranked test puts every student on one leaderboard, so they all have to sit the same paper. Choose a fixed paper, or make this a practice test.';

/** The same rule said against the series that decided the mode, since no screen can change it here. */
export const rankedSeriesNeedsFixed = (seriesName: string): string =>
  `${seriesName} puts every student on one leaderboard, so its tests all sit the same paper. Choose a fixed paper, or put this test in a practice series.`;

/** A rank only means something if everyone sat the same paper. */
export function paperBindingIssue(
  evaluationMode: EvaluationMode,
  paperBinding: PaperBinding,
  seriesName: string | null = null,
): string | null {
  if (isPaperBindingAllowed(evaluationMode, paperBinding)) return null;
  return seriesName === null ? RANKED_NEEDS_FIXED_MESSAGE : rankedSeriesNeedsFixed(seriesName);
}

export const SERIES_GONE_MESSAGE = 'That series no longer exists.';

/** Every refusal of a series lands on the one control that chose it, so all of them are thrown alike. */
export const seriesRefused = (message: string): AppException =>
  new AppException(ErrorCodes.VALIDATION_ERROR, message, {
    fieldErrors: { testSeriesId: [message] },
  });

const stageMismatch = (seriesName: string): string =>
  `${seriesName} is built for a different exam stage, and a test reaches students through the series carrying it.`;

/** A series carries a test only if it is built for its stage and judges it the way it is judged. */
export function seriesFitIssue(
  series: { name: string; examStageId: string | null; evaluationMode: EvaluationMode },
  test: { examStageId: string; evaluationMode: EvaluationMode | undefined },
): string | null {
  if (series.examStageId !== null && series.examStageId !== test.examStageId) {
    return stageMismatch(series.name);
  }
  // A test being created has no mode of its own yet: the series it is born into decides it.
  if (test.evaluationMode === undefined) return null;
  return seriesModeMismatch(series.name, series.evaluationMode, test.evaluationMode);
}

export const TOO_FEW_VARIANTS_MESSAGE = `A test that draws a paper per student needs at least ${MIN_PAPER_VARIANTS} to draw from. Give it that many, or make it a fixed paper.`;

/** Too few papers and a cohort is back to sitting one, which is what fixed already does better. */
export function variantCountIssue(paperBinding: PaperBinding, variantCount: number): string | null {
  const fixed = paperBinding === PAPER_BINDING.FIXED;
  return !fixed && variantCount < MIN_PAPER_VARIANTS ? TOO_FEW_VARIANTS_MESSAGE : null;
}

/** A fixed paper is one paper. Held rather than refused: no screen can ask for anything else. */
export function variantCountFor(paperBinding: PaperBinding, wanted: number | undefined): number {
  if (paperBinding === PAPER_BINDING.FIXED) return 1;
  return wanted ?? DEFAULT_PAPER_VARIANTS;
}

const SCOPE_REFERENCE_REQUIRED: Record<TestScope, keyof TestScopeRef | null> = {
  [TEST_SCOPE.FULL]: null,
  [TEST_SCOPE.MODULE]: 'moduleId',
  [TEST_SCOPE.SECTIONAL]: 'sectionId',
};

const SCOPE_REFERENCE_PROMPT: Record<TestScope, string> = {
  [TEST_SCOPE.FULL]: 'A full test covers the whole paper, so it names no part of it.',
  [TEST_SCOPE.MODULE]: 'A module test has to say which module it covers.',
  [TEST_SCOPE.SECTIONAL]: 'A sectional test has to say which section it covers.',
};

/** A scope without its reference is a test nobody can build a paper for. */
export function scopeRefIssue(scope: TestScope, scopeRef: TestScopeRef | null): string | null {
  const required = SCOPE_REFERENCE_REQUIRED[scope];
  if (required === null) {
    return scopeRef && Object.keys(scopeRef).length > 0 ? SCOPE_REFERENCE_PROMPT[scope] : null;
  }
  return scopeRef?.[required] === undefined ? SCOPE_REFERENCE_PROMPT[scope] : null;
}

/** The one field a sat test may still change: renaming it moves no question. */
export const TEST_UNFROZEN_FIELDS = ['title'] as const;

/** Neither of these can change WHICH questions the paper holds, so neither unfreezes one. */
export const PAPER_NEUTRAL_FIELDS = ['title', 'examTemplate'] as const;

export const SAT_TEST_MESSAGE =
  'Students have sat this test, so its paper cannot move under their results. Only its name still changes.';

export function locksOutTestEdit(input: UpdateTestBody): boolean {
  const unfrozen = new Set<string>(TEST_UNFROZEN_FIELDS);
  return Object.keys(input).some((key) => !unfrozen.has(key));
}

/** A frozen paper thaws only for an edit that could change what it holds — a re-skin cannot. */
export function thawsThePaper(input: UpdateTestBody): boolean {
  const neutral = new Set<string>(PAPER_NEUTRAL_FIELDS);
  return Object.keys(input).some((key) => !neutral.has(key));
}

/** A frozen paper that no longer matches its own scope is worse than either state, so it thaws. */
export function unfreezing(test: { isLocked: boolean }) {
  if (!test.isLocked) return {};
  return {
    isLocked: false,
    finalizedAt: null,
    status: TEST_STATUS.DRAFT,
    // Or a finalize still holding the version it read could re-freeze behind this edit.
    version: { increment: 1 },
  };
}

export const ALREADY_FINALIZED_MESSAGE =
  'This test is already finalized. Its paper is frozen and cannot be drawn again.';

export const NO_PAPER_MESSAGE =
  'This test has no paper yet. Draw or choose its questions before finalizing it.';

/** Every section at its exact count, or the paper is not the one the config describes. */
export function paperCompletenessIssues(
  sections: readonly { id: string; name: string; questionCount: number }[],
  drawnSectionIds: readonly string[],
): string[] {
  if (drawnSectionIds.length === 0) return [NO_PAPER_MESSAGE];

  const held = new Map<string, number>();
  for (const id of drawnSectionIds) held.set(id, (held.get(id) ?? 0) + 1);

  const issues = sections.flatMap((section) => {
    const count = held.get(section.id) ?? 0;
    if (count === section.questionCount) return [];
    return [`${section.name} holds ${count} of the ${section.questionCount} it needs.`];
  });

  // A row pointing at a section the config no longer has would freeze a paper nothing can score.
  const orphaned = [...held.keys()].filter((id) => !sections.some((section) => section.id === id));
  if (orphaned.length > 0) {
    issues.push('The paper holds questions for a section this configuration no longer has.');
  }

  return issues;
}

/** A test reaches a student only once its paper has stopped moving; its series is a column now. */
export function activationBlocker(test: { isLocked: boolean }): string | null {
  if (test.isLocked) return null;
  return 'Finalize this test before offering it. Until its paper is frozen there is nothing for a student to sit.';
}

/** Being SAT is the only history: `Attempt.testId` is the one dependency the database refuses. */
export function testDeletionBlocker(usage: { attemptCount: number }): string | null {
  if (usage.attemptCount === 0) return null;
  const attempts = `${usage.attemptCount} attempt${usage.attemptCount === 1 ? '' : 's'}`;
  return `${attempts} were sat on this test. Retire it instead — it keeps its results and is simply no longer offered.`;
}
