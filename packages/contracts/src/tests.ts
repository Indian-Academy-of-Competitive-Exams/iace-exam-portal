import { z } from 'zod';
import { csvIdQuery, csvQuery, searchQuery } from './common';
import { paginationQuerySchema } from './envelope';
import { baseConfigDetailSchema, examTemplateSchema, stageRefSchema } from './configs';
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
} as const;
export const testScopeSchema = z.enum(TEST_SCOPE);
export type TestScope = z.infer<typeof testScopeSchema>;
export const TEST_SCOPES = testScopeSchema.options;

/** What a test covers. Everything else about its shape comes from its base configuration. */
export const TEST_SCOPE_LABELS: Readonly<Record<TestScope, string>> = {
  FULL: 'Full paper',
  MODULE: 'Module',
  SECTIONAL: 'Sectional',
};

/** RANKED produces a cohort rank and forces a FIXED paper; PRACTICE never ranks. */
export const EVALUATION_MODE = {
  RANKED: 'RANKED',
  PRACTICE: 'PRACTICE',
} as const;
export const evaluationModeSchema = z.enum(EVALUATION_MODE);
export type EvaluationMode = z.infer<typeof evaluationModeSchema>;
export const EVALUATION_MODES = evaluationModeSchema.options;

export const EVALUATION_MODE_LABELS: Readonly<Record<EvaluationMode, string>> = {
  RANKED: 'Ranked',
  PRACTICE: 'Practice',
};

/** FIXED is one paper every student sits; GENERATED is several, drawn at finalize and dealt by seed. */
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
  evaluationMode?: EvaluationMode;
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

/** A cutoff, an allowance and a per-program stagger all serve a cohort; practice just opens. */
export function allowsCohortScheduling(evaluationMode: EvaluationMode): boolean {
  return evaluationMode === EVALUATION_MODE.RANKED;
}

/** One sentence, so the picker refuses a move in the words the server would have refused it in. */
export function seriesModeMismatch(
  seriesName: string,
  seriesMode: EvaluationMode,
  testMode: EvaluationMode,
): string | null {
  if (seriesMode === testMode) return null;
  const held = EVALUATION_MODE_LABELS[seriesMode];
  const wanted = EVALUATION_MODE_LABELS[testMode];
  return `${seriesName} judges its tests as ${held} and this test is judged as ${wanted}. A test is judged the way its series is, so move it to a ${wanted} series instead.`;
}

/** The only change a frozen paper permits, and both recompute every score. */
export const PAPER_QUESTION_STATUS = {
  ACTIVE: 'ACTIVE',
  DROPPED: 'DROPPED',
  BONUS: 'BONUS',
} as const;
export const paperQuestionStatusSchema = z.enum(PAPER_QUESTION_STATUS);
export type PaperQuestionStatus = z.infer<typeof paperQuestionStatusSchema>;

/** Which slice of the config a scoped test covers. FULL carries none of it. */
export const testScopeRefSchema = z.object({
  moduleId: z.string().min(1).optional(),
  sectionId: z.string().min(1).optional(),
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

/** The shape a section needs for the scope rule to place it. */
export interface ScopedSection {
  id: string;
  moduleId: string | null;
  questionCount: number;
}

/** The sections a test's scope puts in play — built, drawn, counted and judged over these alone. */
export function scopedSections<T extends ScopedSection>(
  sections: readonly T[],
  scope: TestScope,
  scopeRef: TestScopeRef | null,
): readonly T[] {
  if (scope === TEST_SCOPE.SECTIONAL) {
    return sections.filter((section) => section.id === scopeRef?.sectionId);
  }
  if (scope === TEST_SCOPE.MODULE) {
    return sections.filter((section) => section.moduleId === scopeRef?.moduleId);
  }
  return sections;
}

/** What a section says about its own clock. Both are null on a paper carrying one timer for all of it. */
export interface TimedScopedSection extends ScopedSection {
  durationSec: number | null;
  perQuestionSec: number | null;
}

/** A whole paper keeps the configuration's clock; only a scope narrows it, and never silently. */
export function scopedDurationSec(
  sections: readonly TimedScopedSection[],
  config: { durationSec: number; totalQuestions: number },
  scope: TestScope,
  scopeRef: TestScopeRef | null,
): number {
  if (scope === TEST_SCOPE.FULL) return config.durationSec;

  const covered = scopedSections(sections, scope, scopeRef);
  if (covered.length === 0) return config.durationSec;

  if (covered.every((section) => section.durationSec !== null)) {
    return covered.reduce((total, section) => total + (section.durationSec ?? 0), 0);
  }

  if (covered.every((section) => section.perQuestionSec !== null)) {
    return covered.reduce(
      (total, section) => total + section.questionCount * (section.perQuestionSec ?? 0),
      0,
    );
  }

  const questions = covered.reduce((total, section) => total + section.questionCount, 0);
  if (config.totalQuestions <= 0 || questions <= 0) return config.durationSec;
  // Rounded to the minute: a share of a composite clock is an estimate, and 9m41s reads as a bug.
  const share = (config.durationSec * questions) / config.totalQuestions;
  return Math.max(60, Math.round(share / 60) * 60);
}

/** A scoped section still has to say what a question is worth, for the marks its paper carries. */
export interface ScoredScopedSection extends ScopedSection {
  marksPerQuestion: number;
}

/** What a scoped test's paper is worth, for the same reason its question count is its own. */
export function scopedMarks(
  sections: readonly ScoredScopedSection[],
  scope: TestScope,
  scopeRef: TestScopeRef | null,
): number {
  return scopedSections(sections, scope, scopeRef).reduce(
    (total, section) => total + section.questionCount * section.marksPerQuestion,
    0,
  );
}

/** What a scoped test's whole paper comes to — never the configuration's total, which is bigger. */
export function scopedQuestionCount(
  sections: readonly ScopedSection[],
  scope: TestScope,
  scopeRef: TestScopeRef | null,
): number {
  return scopedSections(sections, scope, scopeRef).reduce(
    (total, section) => total + section.questionCount,
    0,
  );
}

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

// ============================================================================
// Picking a fixed paper by hand. The split stops being an instruction to the
// draw and becomes the bound on what may be shortlisted, so one set of numbers
// governs both. Nothing here removes a question: a section already picked flags
// what its own settings moved out from under, and the admin decides.
// ============================================================================

/** A question the section already holds, as the picker judges it. */
export interface PickedQuestion {
  questionId: string;
  difficulty: DifficultyLevel;
  topicId: string | null;
}

/** What one difficulty has taken, against what the split allows it. */
export interface QuotaBucket {
  chosen: number;
  /** Null where no split bounds it, and the section's own count is the only ceiling. */
  allowed: number | null;
}
export type SectionQuota = Readonly<Record<DifficultyLevel, QuotaBucket>>;

/** Why a section's own settings turn a question away. The screen writes the words. */
export const PICK_REFUSAL = {
  SECTION_FULL: 'SECTION_FULL',
  QUOTA_MET: 'QUOTA_MET',
  OFF_TOPIC: 'OFF_TOPIC',
} as const;
export type PickRefusal = (typeof PICK_REFUSAL)[keyof typeof PICK_REFUSAL];

export function sectionQuota(
  mix: DifficultyMix | undefined,
  chosen: readonly DifficultyLevel[],
): SectionQuota {
  return Object.fromEntries(
    DIFFICULTY_LEVELS.map((level) => [
      level,
      { chosen: chosen.filter((held) => held === level).length, allowed: mix?.[level] ?? null },
    ]),
  ) as SectionQuota;
}

/** Why this section will not take another question of this difficulty, or null. */
export function pickIssue(
  level: DifficultyLevel,
  quota: SectionQuota,
  questionCount: number,
): PickRefusal | null {
  const taken = DIFFICULTY_LEVELS.reduce((sum, held) => sum + quota[held].chosen, 0);
  if (taken >= questionCount) return PICK_REFUSAL.SECTION_FULL;

  const { chosen, allowed } = quota[level];
  return allowed !== null && chosen >= allowed ? PICK_REFUSAL.QUOTA_MET : null;
}

/** The section's quota with questions only shortlisted counted too, so a batch judges itself. */
export function quotaWithPicks(
  quota: SectionQuota,
  picks: readonly DifficultyLevel[],
): SectionQuota {
  return Object.fromEntries(
    DIFFICULTY_LEVELS.map((level) => [
      level,
      { ...quota[level], chosen: quota[level].chosen + picks.filter((p) => p === level).length },
    ]),
  ) as SectionQuota;
}

/** One question a shortlist is being built from, in the order it is offered. */
export interface OfferedQuestion {
  questionId: string;
  difficulty: DifficultyLevel;
}

/** As much of `wanted` as the section can still take, in `order`, stopped where it fills. */
export function boundedPicks(
  order: readonly OfferedQuestion[],
  wanted: ReadonlySet<string>,
  held: ReadonlySet<string>,
  quota: SectionQuota,
  questionCount: number,
): Map<string, DifficultyLevel> {
  const kept = new Map<string, DifficultyLevel>();

  for (const { questionId, difficulty } of order) {
    if (!wanted.has(questionId) || kept.has(questionId) || held.has(questionId)) continue;
    const room = quotaWithPicks(quota, [...kept.values()]);
    if (pickIssue(difficulty, room, questionCount) === null) kept.set(questionId, difficulty);
  }

  return kept;
}

/** The ones on the paper this section would no longer offer, keyed by question. */
export function strandedPicks(
  chosen: readonly PickedQuestion[],
  spec: SectionDrawSpec | undefined,
): Record<string, PickRefusal> {
  const seen = Object.fromEntries(DIFFICULTY_LEVELS.map((level) => [level, 0])) as Record<
    DifficultyLevel,
    number
  >;
  const stranded: Record<string, PickRefusal> = {};

  for (const pick of chosen) {
    seen[pick.difficulty] += 1;
    // Order decides which of an over-quota bucket is the surplus: the paper's own, so it holds still.
    if (offTopic(pick, spec)) stranded[pick.questionId] = PICK_REFUSAL.OFF_TOPIC;
    else if (spec?.mix && seen[pick.difficulty] > spec.mix[pick.difficulty]) {
      stranded[pick.questionId] = PICK_REFUSAL.QUOTA_MET;
    }
  }

  return stranded;
}

function offTopic(pick: PickedQuestion, spec: SectionDrawSpec | undefined): boolean {
  if (!spec?.topicIds?.length) return false;
  return pick.topicId === null || !spec.topicIds.includes(pick.topicId);
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
  /** This test's own copy — the config's is only what it started from. */
  examTemplate: examTemplateSchema,
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
  /** The one series carrying it. The column requires one, so this is never absent. */
  testSeriesId: z.string(),
  /** That series' name, so a screen can say which one decided the mode without a second request. */
  testSeriesName: z.string(),
  /** How much of the paper is drawn, so a screen knows the work left without reading the paper. */
  paperQuestionCount: z.number().int(),
  createdAt: z.string(),
});
export type Test = z.infer<typeof testSchema>;

/** A stagger on top of the series' own unlock, for one program sitting inside it. */
export const testProgramUnlockSchema = z.object({
  programCode: z.string(),
  opensAt: z.string(),
});
export type TestProgramUnlock = z.infer<typeof testProgramUnlockSchema>;

/** The test plus the blueprint it reads its shape from, so a screen renders both in one request. */
export const testDetailSchema = testSchema.extend({
  baseConfig: baseConfigDetailSchema,
  /** Position inside that series, which is what a progressive ramp is read along. */
  seriesOrder: z.number().int().nullable(),
  /** When this test opens. Null opens with the series it sits in. */
  opensAt: z.string().nullable(),
  /** Per-program staggers on top of `opensAt`. Empty is no program-specific delay. */
  programUnlocks: z.array(testProgramUnlockSchema),
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

/** What a test owes before students can be given it. Each is shown, ticked or not. */
export const OFFER_REQUIREMENT = {
  PAPER: 'PAPER',
} as const;
export type OfferRequirementKey = (typeof OFFER_REQUIREMENT)[keyof typeof OFFER_REQUIREMENT];

export interface OfferRequirement {
  key: OfferRequirementKey;
  met: boolean;
  /** What has to be true, in the words the checklist shows whether it is or not. */
  label: string;
  /** How far off it is, when it is not. */
  owed: string | null;
}

/** A full TOTAL is every section full: nothing may exceed a section's own count, so it cannot hide. */
export function offerRequirements(
  test: Pick<
    Test,
    'isLocked' | 'paperBinding' | 'paperQuestionCount' | 'totalQuestions' | 'variantCount'
  >,
): OfferRequirement[] {
  return [paperRequirement(test)];
}

/** Whether a paper is still owed. The stepper's tick, the checklist and the landing step all read it. */
export function owesAPaper(test: Parameters<typeof offerRequirements>[0]): boolean {
  const paper = offerRequirements(test).find(
    (requirement) => requirement.key === OFFER_REQUIREMENT.PAPER,
  );
  return paper?.met !== true;
}

/** Reopening lands on the step still owing work, so a half-built paper is never walked past. */
export function testBuilderStepOf(test: Parameters<typeof offerRequirements>[0]): TestBuilderStep {
  return owesAPaper(test) ? TEST_BUILDER_STEP.PAPER : TEST_BUILDER_STEP.OFFER;
}

function paperRequirement(test: Parameters<typeof offerRequirements>[0]): OfferRequirement {
  if (test.paperBinding !== PAPER_BINDING.FIXED) {
    return {
      key: OFFER_REQUIREMENT.PAPER,
      met: true,
      label: `Its ${test.variantCount} papers are drawn the moment it is offered`,
      owed: null,
    };
  }

  const met = test.isLocked || test.paperQuestionCount === test.totalQuestions;
  return {
    key: OFFER_REQUIREMENT.PAPER,
    met,
    label: `All ${test.totalQuestions} questions are on the paper`,
    owed: met ? null : `${test.paperQuestionCount} chosen so far`,
  };
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

/** DROPPED pays everyone who attempted it; BONUS pays the whole cohort; ACTIVE undoes either. */
export const setPaperQuestionStatusSchema = z.object({ status: paperQuestionStatusSchema });
export type SetPaperQuestionStatusInput = z.input<typeof setPaperQuestionStatusSchema>;
export type SetPaperQuestionStatusBody = z.infer<typeof setPaperQuestionStatusSchema>;

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

/** Each variant is a whole paper on file, so the ceiling is rows in the table, not a preference. */
export const MAX_PAPER_VARIANTS = 50;
/** Under this a cohort shares papers too often for drawing them apart to have been worth it. */
export const MIN_PAPER_VARIANTS = 5;
/** Enough that two students rarely share a paper, few enough that every one can be looked at. */
export const DEFAULT_PAPER_VARIANTS = 10;

/** Everything a test owns, shared by create and update. `baseConfigId` is only ever set once. */
const testOwnFieldsSchema = z.object({
  scope: testScopeSchema.optional(),
  scopeRef: testScopeRefSchema.nullish(),
  paperBinding: paperBindingSchema.optional(),
  /** Absent on create means take the config's; a test chooses its own screen from then on. */
  examTemplate: examTemplateSchema.optional(),
  /** How many papers to draw. A fixed test is one, and the server holds it there. */
  variantCount: z.coerce.number().int().min(1).max(MAX_PAPER_VARIANTS).optional(),
  questionPoolFilter: drawSpecSchema.nullish(),
});

/** `examStageId` is absent on purpose: it is the config's, and the composite FK enforces it. */
export const createTestSchema = testOwnFieldsSchema.extend({
  title: testTitleSchema,
  baseConfigId: z.string().min(1, 'Choose a config'),
  /** `evaluationMode` is absent for the same reason: the series decides it, and the body cannot. */
  testSeriesId: z.string().min(1, 'Choose a series'),
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

/** Enough of a question to READ a row of the paper, not merely to recognise its code. */
export const paperQuestionRefSchema = z.object({
  id: z.string(),
  questionCode: z.string().nullable(),
  /** The same shortened stem the bank shows, so both halves of the screen read alike. */
  stemPreview: z.string(),
  difficulty: difficultyLevelSchema,
  subjectId: z.string(),
  topicId: z.string().nullable(),
});
export type PaperQuestionRef = z.infer<typeof paperQuestionRefSchema>;

export const paperRowSchema = paperQuestionSchema.extend({
  question: paperQuestionRefSchema,
});
export type PaperRow = z.infer<typeof paperRowSchema>;

/** One section of the paper, beside the count the config asks it to hold. */
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

/** Absent reads the paper every FIXED test has and a GENERATED one drew first. */
export const readPaperQuerySchema = z.object({
  variant: z.coerce.number().int().min(0).optional(),
});
export type ReadPaperQuery = z.infer<typeof readPaperQuerySchema>;

/** One test as the SERIES reads it: what it is called, when it opens there, and whether it is sat. */
export const seriesTestRowSchema = z.object({
  testId: z.string(),
  title: z.string().nullable(),
  order: z.number().int().nullable(),
  unlockAt: z.string().nullable(),
  /** Nothing that has been sat may be taken out of a series, so the row says whether it has. */
  attemptCount: z.number().int(),
});
export type SeriesTestRow = z.infer<typeof seriesTestRowSchema>;

/** Null opens it with the series. The instant is the same for every branch. */
export const setSeriesTestUnlockSchema = z.object({ unlockAt: z.iso.datetime().nullish() });
export type SetSeriesTestUnlockInput = z.input<typeof setSeriesTestUnlockSchema>;
export type SetSeriesTestUnlockBody = z.infer<typeof setSeriesTestUnlockSchema>;

/** When one program's cohort may begin, ahead of everybody else. Entry still closes together. */
export const setProgramUnlockSchema = z.object({ opensAt: z.iso.datetime() });
export type SetProgramUnlockInput = z.input<typeof setProgramUnlockSchema>;
export type SetProgramUnlockBody = z.infer<typeof setProgramUnlockSchema>;

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

/** The series it moves to. A test belongs to exactly one and is never left in none. */
export const setTestSeriesSchema = z.object({
  testSeriesId: z.string().min(1),
});
export type SetTestSeriesInput = z.input<typeof setTestSeriesSchema>;
export type SetTestSeriesBody = z.infer<typeof setTestSeriesSchema>;

/** Swapping ONE question, so a paper that is right but for a single row is not redrawn whole. */
export const replacePaperQuestionSchema = z.object({
  questionId: z.string().min(1, 'Choose a question'),
});
export type ReplacePaperQuestionInput = z.input<typeof replacePaperQuestionSchema>;
export type ReplacePaperQuestionBody = z.infer<typeof replacePaperQuestionSchema>;

/** Putting several on the paper in one request, in the next free places its section has. */
/** Which rows go. A CSV rather than a body, because a DELETE body does not survive every proxy. */
export const removePaperQuestionsSchema = z.object({
  rowIds: csvIdQuery(),
});
export type RemovePaperQuestionsQuery = z.infer<typeof removePaperQuestionsSchema>;

export const addPaperQuestionSchema = z.object({
  baseConfigSectionId: z.string().min(1),
  questionIds: z.array(z.string().min(1)).min(1, 'Choose at least one question'),
});
export type AddPaperQuestionInput = z.input<typeof addPaperQuestionSchema>;
export type AddPaperQuestionBody = z.infer<typeof addPaperQuestionSchema>;

/** Freezing and opening are ONE action, so they answer with one result. */
export const offerResultSchema = finalizeResultSchema.extend({ status: testStatusSchema });
export type OfferResult = z.infer<typeof offerResultSchema>;

export const ADMIN_TEST_PAPER_ROUTES = {
  read: (id: string) => `/admin/tests/${id}/paper`,
  addQuestion: (id: string) => `/admin/tests/${id}/paper/questions`,
  replaceQuestion: (id: string, rowId: string) => `/admin/tests/${id}/paper/${rowId}`,
  removeQuestions: (id: string) => `/admin/tests/${id}/paper/questions`,
  /** Draws the rest of one section from its own spec, around the rows already on it. */
  fillSection: (id: string, sectionId: string) =>
    `/admin/tests/${id}/paper/sections/${sectionId}/fill`,
  /** The ONE change a finalized paper still allows: withdrawing a question, or paying it to all. */
  questionStatus: (id: string, rowId: string) => `/admin/tests/${id}/paper/${rowId}/status`,
  finalize: (id: string) => `/admin/tests/${id}/finalize`,
  offer: (id: string) => `/admin/tests/${id}/offer`,
  setStatus: (id: string) => `/admin/tests/${id}/status`,
  series: (id: string) => `/admin/tests/${id}/series`,
  programUnlock: (id: string, programCode: string) =>
    `/admin/tests/${id}/program-unlocks/${encodeURIComponent(programCode)}`,
} as const;
