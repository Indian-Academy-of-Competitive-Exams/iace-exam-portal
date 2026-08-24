import {
  DRAW_STRATEGY,
  EVALUATION_MODE,
  isPaperBindingAllowed,
  PAPER_BINDING,
  TEST_SCOPE,
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

/** The one field a frozen test may still change: renaming it moves no question. */
export const TEST_UNFROZEN_FIELDS = ['title'] as const;

export const FROZEN_TEST_MESSAGE =
  'This test is finalized — its paper is frozen and students may already have sat it. Only its name still changes.';

export function locksOutTestEdit(input: UpdateTestBody): boolean {
  const unfrozen = new Set<string>(TEST_UNFROZEN_FIELDS);
  return Object.keys(input).some((key) => !unfrozen.has(key));
}

/** A test that has been sat, offered or frozen is history — deleting it would take that with it. */
export function testDeletionBlocker(usage: {
  isLocked: boolean;
  attemptCount: number;
  seriesCount: number;
}): string | null {
  if (usage.attemptCount > 0) {
    const attempts = `${usage.attemptCount} attempt${usage.attemptCount === 1 ? '' : 's'}`;
    return `${attempts} were sat on this test. Retire it instead — it keeps its results and is simply no longer offered.`;
  }
  if (usage.isLocked) {
    return 'This test is finalized, so its paper is frozen. Retire it instead — it keeps everything it has and is simply no longer offered.';
  }
  if (usage.seriesCount > 0) {
    const series = `${usage.seriesCount} series`;
    return `${series} still offer this test. Take it out of them first.`;
  }
  return null;
}
