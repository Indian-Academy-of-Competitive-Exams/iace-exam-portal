import { z } from 'zod';

// ============================================================================
// Tests and papers. A test is minimal: it inherits marks, duration, timing,
// structure, shuffle and language from its config, and adds only what it
// covers, whether it is ranked, and where its questions come from.
// ============================================================================

export const TEST_STATUS = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export const testStatusSchema = z.enum(TEST_STATUS);
export type TestStatus = z.infer<typeof testStatusSchema>;
export const TEST_STATUSES = testStatusSchema.options;

/** What the test covers. Timing follows from it. */
export const TEST_SCOPE = {
  FULL: 'FULL',
  MODULE: 'MODULE',
  SECTIONAL: 'SECTIONAL',
  TOPIC: 'TOPIC',
} as const;
export const testScopeSchema = z.enum(TEST_SCOPE);
export type TestScope = z.infer<typeof testScopeSchema>;
export const TEST_SCOPES = testScopeSchema.options;

/** RANKED produces a cohort rank and forces a FIXED paper; PRACTICE never ranks. */
export const EVALUATION_MODE = {
  RANKED: 'RANKED',
  PRACTICE: 'PRACTICE',
} as const;
export const evaluationModeSchema = z.enum(EVALUATION_MODE);
export type EvaluationMode = z.infer<typeof evaluationModeSchema>;
export const EVALUATION_MODES = evaluationModeSchema.options;

/** FIXED is drawn once at finalize and shared; GENERATED is drawn per attempt. */
export const PAPER_BINDING = {
  FIXED: 'FIXED',
  GENERATED: 'GENERATED',
} as const;
export const paperBindingSchema = z.enum(PAPER_BINDING);
export type PaperBinding = z.infer<typeof paperBindingSchema>;
export const PAPER_BINDINGS = paperBindingSchema.options;

/** A rank only means something if everyone sat the same paper. */
export function isPaperBindingAllowed(
  evaluationMode: EvaluationMode,
  paperBinding: PaperBinding,
): boolean {
  return evaluationMode !== EVALUATION_MODE.RANKED || paperBinding === PAPER_BINDING.FIXED;
}

export const DRAW_STRATEGY = {
  RANDOM: 'RANDOM',
  NEWEST_FIRST: 'NEWEST_FIRST',
  LEAST_SERVED: 'LEAST_SERVED',
  UNSEEN_FIRST: 'UNSEEN_FIRST',
} as const;
export const drawStrategySchema = z.enum(DRAW_STRATEGY);
export type DrawStrategy = z.infer<typeof drawStrategySchema>;
export const DRAW_STRATEGIES = drawStrategySchema.options;

/** The only change a frozen paper permits, and both recompute every score. */
export const PAPER_QUESTION_STATUS = {
  ACTIVE: 'ACTIVE',
  DROPPED: 'DROPPED',
  BONUS: 'BONUS',
} as const;
export const paperQuestionStatusSchema = z.enum(PAPER_QUESTION_STATUS);
export type PaperQuestionStatus = z.infer<typeof paperQuestionStatusSchema>;
export const PAPER_QUESTION_STATUSES = paperQuestionStatusSchema.options;

export const testSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  baseConfigId: z.string(),
  examStageId: z.string(),
  scope: testScopeSchema,
  evaluationMode: evaluationModeSchema,
  paperBinding: paperBindingSchema,
  /** Null means unlimited. A ranked graded attempt is always one. */
  maxRetakes: z.number().int().nullable(),
  drawStrategy: drawStrategySchema,
  status: testStatusSchema,
  /** True once the paper is frozen. */
  isLocked: z.boolean(),
  /** Optimistic lock: finalize is a conditional update against it. */
  version: z.number().int(),
  finalizedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Test = z.infer<typeof testSchema>;

/** The frozen shared paper. Only a FIXED test has these. */
export const paperQuestionSchema = z.object({
  id: z.string(),
  testId: z.string(),
  /** Denormalised from the test, so the composite key to the section is always whole. */
  baseConfigId: z.string(),
  baseConfigSectionId: z.string(),
  questionId: z.string(),
  /** The version this paper serves, so a result reproduces after the question is edited. */
  questionVersionId: z.string(),
  order: z.number().int(),
  marks: z.number(),
  negativeMarks: z.number(),
  status: paperQuestionStatusSchema,
});
export type PaperQuestion = z.infer<typeof paperQuestionSchema>;
