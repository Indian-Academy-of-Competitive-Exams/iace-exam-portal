import {
  DRAW_STRATEGY,
  EVALUATION_MODE,
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

/** What a test is when the admin says nothing. Written explicitly, not left to the column. */
export const TEST_DEFAULTS = {
  scope: TEST_SCOPE.FULL,
  evaluationMode: EVALUATION_MODE.RANKED,
  paperBinding: PAPER_BINDING.FIXED,
  drawStrategy: DRAW_STRATEGY.RANDOM,
} as const;

export const RANKED_NEEDS_FIXED_MESSAGE =
  'A ranked test puts every student on one leaderboard, so they all have to sit the same paper. Choose a fixed paper, or make this a practice test.';

/** A rank only means something if everyone sat the same paper. */
export function paperBindingIssue(
  evaluationMode: EvaluationMode,
  paperBinding: PaperBinding,
): string | null {
  return isPaperBindingAllowed(evaluationMode, paperBinding) ? null : RANKED_NEEDS_FIXED_MESSAGE;
}

const SCOPE_REFERENCE_REQUIRED: Record<TestScope, keyof TestScopeRef | null> = {
  [TEST_SCOPE.FULL]: null,
  [TEST_SCOPE.MODULE]: 'moduleId',
  [TEST_SCOPE.SECTIONAL]: 'sectionId',
  [TEST_SCOPE.TOPIC]: 'topicIds',
};

const SCOPE_REFERENCE_PROMPT: Record<TestScope, string> = {
  [TEST_SCOPE.FULL]: 'A full test covers the whole paper, so it names no part of it.',
  [TEST_SCOPE.MODULE]: 'A module test has to say which module it covers.',
  [TEST_SCOPE.SECTIONAL]: 'A sectional test has to say which section it covers.',
  [TEST_SCOPE.TOPIC]: 'A topic test has to name at least one topic.',
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

export const SAT_TEST_MESSAGE =
  'Students have sat this test, so its paper cannot move under their results. Only its name still changes.';

export function locksOutTestEdit(input: UpdateTestBody): boolean {
  const unfrozen = new Set<string>(TEST_UNFROZEN_FIELDS);
  return Object.keys(input).some((key) => !unfrozen.has(key));
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

/** A test reaches a student only through a series, and only once its paper has stopped moving. */
export function activationBlocker(test: { isLocked: boolean; seriesCount: number }): string | null {
  if (!test.isLocked) {
    return 'Finalize this test before offering it. Until its paper is frozen there is nothing for a student to sit.';
  }
  if (test.seriesCount === 0) {
    return 'A test reaches a student only through a series. Add this one to at least one before offering it.';
  }
  return null;
}

/** Being SAT is the only history: `Attempt.testId` is the one dependency the database refuses. */
export function testDeletionBlocker(usage: { attemptCount: number }): string | null {
  if (usage.attemptCount === 0) return null;
  const attempts = `${usage.attemptCount} attempt${usage.attemptCount === 1 ? '' : 's'}`;
  return `${attempts} were sat on this test. Retire it instead — it keeps its results and is simply no longer offered.`;
}
