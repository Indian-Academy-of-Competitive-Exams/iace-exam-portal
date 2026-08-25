import { z } from 'zod';
import { csvIdQuery, csvQuery, searchQuery } from './common';
import { paginationQuerySchema } from './envelope';
import { baseConfigDetailSchema, stageRefSchema } from './configs';
import {
  DIFFICULTY_LEVELS,
  difficultyLevelSchema,
  tagSchema,
  type DifficultyLevel,
} from './questions';

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

/** What a test is called by: the part of the paper it covers, or failing that how it is judged. */
export function testNameKind(input: {
  scope: TestScope;
  evaluationMode: EvaluationMode;
  scopeName?: string | null;
}): string {
  const named = input.scopeName?.trim();
  if (input.scope !== TEST_SCOPE.FULL && named) return named;
  return input.evaluationMode === EVALUATION_MODE.PRACTICE ? 'Practice' : 'Mock';
}

/** A rank only means something if everyone sat the same paper. */
export function isPaperBindingAllowed(
  evaluationMode: EvaluationMode,
  paperBinding: PaperBinding,
): boolean {
  return evaluationMode !== EVALUATION_MODE.RANKED || paperBinding === PAPER_BINDING.FIXED;
}

/** What a picker may offer, so a form cannot present a pair the server is going to refuse. */
export function allowedPaperBindings(evaluationMode: EvaluationMode): PaperBinding[] {
  return PAPER_BINDINGS.filter((binding) => isPaperBindingAllowed(evaluationMode, binding));
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

/** Which slice of the config a scoped test covers. FULL carries none of it. */
export const testScopeRefSchema = z.object({
  moduleId: z.string().min(1).optional(),
  sectionId: z.string().min(1).optional(),
  topicIds: z.array(z.string().min(1)).min(1).optional(),
});
export type TestScopeRef = z.infer<typeof testScopeRefSchema>;

// ============================================================================
// What a section is drawn FROM. Per section, because marks, timing and counts
// already are. An absent `mix` is not "no mix" — it is the section drawing
// across every difficulty, so one optional field carries both modes and there
// is no toggle to keep in step with it. Absent `topicIds` is the whole subject.
// ============================================================================

export const difficultyMixSchema = z.object({
  LOW: z.number().int().min(0),
  MEDIUM: z.number().int().min(0),
  HIGH: z.number().int().min(0),
});
export type DifficultyMix = z.infer<typeof difficultyMixSchema>;

/** The shares the default is built from. Never stored: what a section keeps is the counts. */
const DEFAULT_SHARES: Readonly<Record<DifficultyLevel, number>> = { LOW: 30, MEDIUM: 40, HIGH: 30 };

/** A split to start from, near 30/40/30, with the middle taking whatever does not divide. */
export function defaultMixFor(questionCount: number): DifficultyMix {
  const parts = DIFFICULTY_LEVELS.map((level) => ({
    level,
    whole: Math.floor((DEFAULT_SHARES[level] * questionCount) / 100),
  }));
  const mix = Object.fromEntries(parts.map((part) => [part.level, part.whole])) as DifficultyMix;
  mix.MEDIUM += questionCount - (mix.LOW + mix.MEDIUM + mix.HIGH);
  return mix;
}

export const sectionDrawSpecSchema = z.object({
  topicIds: z.array(z.string().min(1)).min(1).optional(),
  /** Finer than a topic, which is what a tag is for. ANY of them is enough to be eligible. */
  tags: z.array(tagSchema).min(1).optional(),
  mix: difficultyMixSchema.optional(),
});
export type SectionDrawSpec = z.infer<typeof sectionDrawSpecSchema>;

export const drawSpecSchema = z.object({
  sections: z.record(z.string(), sectionDrawSpecSchema),
});
export type DrawSpec = z.infer<typeof drawSpecSchema>;

export interface FeasibilitySection {
  id: string;
  name: string;
  questionCount: number;
}

/** The one rule the schema cannot hold: it never sees the section, so it never sees the count. */
export function mixIssue(mix: DifficultyMix, section: FeasibilitySection): string | null {
  const total = mix.LOW + mix.MEDIUM + mix.HIGH;
  if (total === section.questionCount) return null;
  return `${section.name} holds ${section.questionCount}, and its difficulty split adds up to ${total}.`;
}

/** What the bank holds for one section once its own subject and its chosen topics are applied. */
export interface SectionAvailability {
  total: number;
  byDifficulty: Partial<Record<DifficultyLevel, number>>;
}

/** `difficulty` is null when the section draws across all of them: the shortfall is its own. */
export interface DrawShortfall {
  baseConfigSectionId: string;
  sectionName: string;
  difficulty: DifficultyLevel | null;
  needed: number;
  available: number;
}

/** Whether the bank can fill this paper. Here, not the server: the form shows the same numbers. */
export function paperFeasibility(
  sections: readonly FeasibilitySection[],
  spec: DrawSpec | null | undefined,
  available: Readonly<Record<string, SectionAvailability>>,
): DrawShortfall[] {
  return sections.flatMap((section) => {
    const held = available[section.id] ?? { total: 0, byDifficulty: {} };
    const mix = spec?.sections?.[section.id]?.mix;

    if (!mix) {
      return held.total >= section.questionCount
        ? []
        : [shortfallOf(section, null, section.questionCount, held.total)];
    }

    return DIFFICULTY_LEVELS.flatMap((level) => {
      const want = mix[level];
      const has = held.byDifficulty[level] ?? 0;
      return want === 0 || has >= want ? [] : [shortfallOf(section, level, want, has)];
    });
  });
}

function shortfallOf(
  section: FeasibilitySection,
  difficulty: DifficultyLevel | null,
  needed: number,
  available: number,
): DrawShortfall {
  return {
    baseConfigSectionId: section.id,
    sectionName: section.name,
    difficulty,
    needed,
    available,
  };
}

export const testSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  baseConfigId: z.string(),
  /** Read through the config, never stored on the test — the shape has one home. */
  baseConfigName: z.string(),
  totalQuestions: z.number().int(),
  durationSec: z.number().int(),
  examStageId: z.string(),
  examStage: stageRefSchema,
  scope: testScopeSchema,
  scopeRef: testScopeRefSchema.nullable(),
  evaluationMode: evaluationModeSchema,
  paperBinding: paperBindingSchema,
  /** Null means unlimited. A ranked graded attempt is always one. */
  maxRetakes: z.number().int().nullable(),
  drawStrategy: drawStrategySchema,
  /** What each section is drawn from. Named for the column it has always lived in. */
  questionPoolFilter: drawSpecSchema.nullable(),
  status: testStatusSchema,
  /** True once the paper is frozen. */
  isLocked: z.boolean(),
  /** Optimistic lock: finalize is a conditional update against it. */
  version: z.number().int(),
  finalizedAt: z.string().nullable(),
  /** How many papers were drawn. One for FIXED; a GENERATED test hands one out per attempt. */
  variantCount: z.number().int(),
  /** What depends on it, so a confirm names the consequence instead of guessing at it. */
  attemptCount: z.number().int(),
  seriesCount: z.number().int(),
  /** How much of the paper is drawn, so a screen knows the work left without reading the paper. */
  paperQuestionCount: z.number().int(),
  createdAt: z.string(),
});
export type Test = z.infer<typeof testSchema>;

/** The test plus the blueprint it reads its shape from, so a screen renders both in one request. */
export const testDetailSchema = testSchema.extend({
  baseConfig: baseConfigDetailSchema,
});
export type TestDetail = z.infer<typeof testDetailSchema>;

/** The phases of building a test, in the order an admin walks them. */
export const TEST_BUILDER_STEP = {
  SETUP: 'SETUP',
  PAPER: 'PAPER',
  OFFER: 'OFFER',
} as const;
export const testBuilderStepSchema = z.enum(TEST_BUILDER_STEP);
export type TestBuilderStep = z.infer<typeof testBuilderStepSchema>;
export const TEST_BUILDER_STEPS = testBuilderStepSchema.options;

/** How far a test has got, so reopening it lands on the step still owing work. */
export function testBuilderStepOf(
  test: Pick<Test, 'isLocked' | 'paperBinding' | 'paperQuestionCount'>,
): TestBuilderStep {
  const owesAPaper =
    test.paperBinding === PAPER_BINDING.FIXED && test.paperQuestionCount === 0 && !test.isLocked;
  return owesAPaper ? TEST_BUILDER_STEP.PAPER : TEST_BUILDER_STEP.OFFER;
}

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
  /** Which of the test's papers this row belongs to. A FIXED test has one, at 0. */
  variant: z.number().int(),
  order: z.number().int(),
  marks: z.number(),
  negativeMarks: z.number(),
  status: paperQuestionStatusSchema,
});
export type PaperQuestion = z.infer<typeof paperQuestionSchema>;

// ============================================================================
// Writing. A test owns only what it covers, how it is judged and where its
// questions come from — every shape field is read through its config.
// ============================================================================

export const TEST_TITLE_MAX = 140;

export const testTitleSchema = z
  .string()
  .trim()
  .min(2, 'Give the test a name')
  .max(TEST_TITLE_MAX, `A name cannot be longer than ${TEST_TITLE_MAX} characters`);

/** Retakes are a small number by design; unlimited is null, not a large one. */
export const MAX_RETAKES_CEILING = 20;

/** Each variant is a whole paper on file, so the ceiling is rows in the table, not a preference. */
export const MAX_PAPER_VARIANTS = 50;
/** Enough that two students rarely share a paper, few enough that every one can be looked at. */
export const DEFAULT_PAPER_VARIANTS = 10;

/** Everything a test owns, shared by create and update. `baseConfigId` is only ever set once. */
const testOwnFieldsSchema = z.object({
  scope: testScopeSchema.optional(),
  scopeRef: testScopeRefSchema.nullish(),
  evaluationMode: evaluationModeSchema.optional(),
  paperBinding: paperBindingSchema.optional(),
  maxRetakes: z.coerce.number().int().min(1).max(MAX_RETAKES_CEILING).nullish(),
  /** How many papers to draw. A fixed test is one, and the server holds it there. */
  variantCount: z.coerce.number().int().min(1).max(MAX_PAPER_VARIANTS).optional(),
  drawStrategy: drawStrategySchema.optional(),
  questionPoolFilter: drawSpecSchema.nullish(),
});

/** `examStageId` is absent on purpose: it is the config's, and the composite FK enforces it. */
export const createTestSchema = testOwnFieldsSchema.extend({
  title: testTitleSchema,
  baseConfigId: z.string().min(1, 'Choose a config'),
});
export type CreateTestInput = z.input<typeof createTestSchema>;
export type CreateTestBody = z.infer<typeof createTestSchema>;

/** A test never changes config — that would change its whole shape. Clone the test instead. */
export const updateTestSchema = testOwnFieldsSchema.extend({
  title: testTitleSchema.optional(),
});
export type UpdateTestInput = z.input<typeof updateTestSchema>;
export type UpdateTestBody = z.infer<typeof updateTestSchema>;

export const testListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
  examId: csvIdQuery(),
  examStageId: z.string().optional(),
  baseConfigId: z.string().optional(),
  status: csvQuery(testStatusSchema),
});
export type TestListQuery = z.infer<typeof testListQuerySchema>;
export type TestListQueryInput = z.input<typeof testListQuerySchema>;

export const ADMIN_TEST_ROUTES = {
  list: '/admin/tests',
  create: '/admin/tests',
  detail: (id: string) => `/admin/tests/${id}`,
  update: (id: string) => `/admin/tests/${id}`,
  remove: (id: string) => `/admin/tests/${id}`,
} as const;

// ============================================================================
// The paper. Drawn or hand-picked while the test is still a draft, frozen at
// finalize — `Test.isLocked` is the freeze, not the existence of these rows.
// ============================================================================

/** Enough of a question to recognise a row of the paper without loading its content. */
export const paperQuestionRefSchema = z.object({
  id: z.string(),
  questionCode: z.string().nullable(),
  difficulty: difficultyLevelSchema,
  subjectId: z.string(),
  topicId: z.string().nullable(),
});
export type PaperQuestionRef = z.infer<typeof paperQuestionRefSchema>;

export const paperRowSchema = paperQuestionSchema.extend({
  question: paperQuestionRefSchema,
});
export type PaperRow = z.infer<typeof paperRowSchema>;

/** One section of the assembled paper, beside the count the config asks it to hold. */
export const paperSectionSchema = z.object({
  baseConfigSectionId: z.string(),
  name: z.string(),
  order: z.number().int(),
  questionCount: z.number().int(),
  questions: z.array(paperRowSchema),
});
export type PaperSection = z.infer<typeof paperSectionSchema>;

export const testPaperSchema = z.object({
  testId: z.string(),
  totalQuestions: z.number().int(),
  sections: z.array(paperSectionSchema),
});
export type TestPaper = z.infer<typeof testPaperSchema>;

/** Chosen by hand for one section. The draw fills whatever is left of its count. */
export const manualSectionPickSchema = z.object({
  baseConfigSectionId: z.string().min(1),
  questionIds: z.array(z.string().min(1)),
});
export type ManualSectionPick = z.infer<typeof manualSectionPickSchema>;

/** Assembling REPLACES the draft paper — a merge over rows the admin cannot see is nobody's ask. */
export const assemblePaperSchema = z.object({
  /** Same seed, same pool, same paper. Omitted means a fresh draw. */
  seed: z.coerce.number().int().min(0).optional(),
  manual: z.array(manualSectionPickSchema).optional(),
});
export type AssemblePaperInput = z.input<typeof assemblePaperSchema>;
export type AssemblePaperBody = z.infer<typeof assemblePaperSchema>;

/** What a finalize did. `finalizedByThisCall` is false when another request got there first. */
export const finalizeResultSchema = z.object({
  testId: z.string(),
  finalizedAt: z.string(),
  finalizedByThisCall: z.boolean(),
  frozenQuestions: z.number().int(),
});
export type FinalizeResult = z.infer<typeof finalizeResultSchema>;

export const setTestStatusSchema = z.object({
  status: testStatusSchema,
});
export type SetTestStatusInput = z.input<typeof setTestStatusSchema>;
export type SetTestStatusBody = z.infer<typeof setTestStatusSchema>;

/** A test reaches a student only through a series, so attaching it is what makes it offerable. */
export const testSeriesLinkSchema = z.object({
  testSeriesId: z.string(),
  name: z.string(),
  order: z.number().int().nullable(),
});
export type TestSeriesLink = z.infer<typeof testSeriesLinkSchema>;

/** The whole set, not a delta: the screen holds every series this test is offered in. */
export const setTestSeriesSchema = z.object({
  series: z.array(
    z.object({
      testSeriesId: z.string().min(1),
      order: z.coerce.number().int().min(0).nullish(),
    }),
  ),
});
export type SetTestSeriesInput = z.input<typeof setTestSeriesSchema>;
export type SetTestSeriesBody = z.infer<typeof setTestSeriesSchema>;

/** Swapping ONE question, so a paper that is right but for a single row is not redrawn whole. */
export const replacePaperQuestionSchema = z.object({
  questionId: z.string().min(1, 'Choose a question'),
});
export type ReplacePaperQuestionInput = z.input<typeof replacePaperQuestionSchema>;
export type ReplacePaperQuestionBody = z.infer<typeof replacePaperQuestionSchema>;

export const ADMIN_TEST_PAPER_ROUTES = {
  read: (id: string) => `/admin/tests/${id}/paper`,
  assemble: (id: string) => `/admin/tests/${id}/paper`,
  replaceQuestion: (id: string, rowId: string) => `/admin/tests/${id}/paper/${rowId}`,
  removeQuestion: (id: string, rowId: string) => `/admin/tests/${id}/paper/${rowId}`,
  finalize: (id: string) => `/admin/tests/${id}/finalize`,
  setStatus: (id: string) => `/admin/tests/${id}/status`,
  series: (id: string) => `/admin/tests/${id}/series`,
} as const;
