import { z } from 'zod';
import { csvIdQuery, optionalBooleanQuery, searchQuery } from './common';
import { paginationQuerySchema } from './envelope';
import { examRefSchema, languageCodeSchema } from './exams';
import { questionMarksSchema } from './questions';

// ============================================================================
// Base configs — a stage's blueprint. A test inherits its shape from one rather
// than restating it, and the config locks at the first finalize of any test
// built from it, so evolving it means cloning it.
// ============================================================================

/** Drives the engine. Section-return behaviour follows from this alone. */
export const TIMER_TEMPLATE = {
  /** One clock across every section, free movement. */
  COMPOSITE_FREE: 'COMPOSITE_FREE',
  /** A clock per section; the section closes when its time ends. */
  SECTIONAL_LOCKED: 'SECTIONAL_LOCKED',
  /** Sessions of sections, each a locked block. */
  SESSION_MODULE_LOCKED: 'SESSION_MODULE_LOCKED',
  /** A countdown per question, auto-advancing at zero. */
  PER_ITEM_TIMED: 'PER_ITEM_TIMED',
} as const;
export const timerTemplateSchema = z.enum(TIMER_TEMPLATE);
export type TimerTemplate = z.infer<typeof timerTemplateSchema>;
export const TIMER_TEMPLATES = timerTemplateSchema.options;

export const NAVIGATION_POLICY = {
  FREE: 'FREE',
  FORWARD_ONLY: 'FORWARD_ONLY',
} as const;
export const navigationPolicySchema = z.enum(NAVIGATION_POLICY);
export type NavigationPolicy = z.infer<typeof navigationPolicySchema>;
export const NAVIGATION_POLICIES = navigationPolicySchema.options;

/** SINGLE lets the student pick one; DUAL renders both, stem and options, with no toggle. */
export const LANGUAGE_MODE = {
  SINGLE: 'SINGLE',
  DUAL: 'DUAL',
} as const;
export const languageModeSchema = z.enum(LANGUAGE_MODE);
export type LanguageMode = z.infer<typeof languageModeSchema>;
export const LANGUAGE_MODES = languageModeSchema.options;

/** Which skin the exam screen wears. Presentation only: one engine, one clock, one paper. */
export const EXAM_TEMPLATE = {
  DEFAULT: 'DEFAULT',
  SSC_RAILWAYS: 'SSC_RAILWAYS',
} as const;
export const examTemplateSchema = z.enum(EXAM_TEMPLATE);
export type ExamTemplate = z.infer<typeof examTemplateSchema>;
export const EXAM_TEMPLATES = examTemplateSchema.options;

/** Where a skin puts things. Read by the sitting AND by the picker that previews it. */
export interface ExamTemplateConfig {
  timerPosition: 'HEADER' | 'SECTION_BAR';
  /** LABELLED spells "Time left" out, the way a government CBT does. */
  timerFormat: 'CLOCK' | 'LABELLED';
  palettePosition: 'LEFT' | 'RIGHT';
  sectionSwitch: 'TABS' | 'BUTTONS';
  /** PAPER marks the question panel, SCREEN the whole sitting behind everything. */
  watermark: 'PAPER' | 'SCREEN' | 'NONE';
}

/** One home, so the admin's preview cannot describe a screen the student does not get. */
export const EXAM_TEMPLATE_CONFIG: Readonly<Record<ExamTemplate, ExamTemplateConfig>> = {
  [EXAM_TEMPLATE.DEFAULT]: {
    timerPosition: 'HEADER',
    timerFormat: 'CLOCK',
    palettePosition: 'RIGHT',
    sectionSwitch: 'TABS',
    watermark: 'PAPER',
  },
  [EXAM_TEMPLATE.SSC_RAILWAYS]: {
    timerPosition: 'SECTION_BAR',
    timerFormat: 'LABELLED',
    palettePosition: 'LEFT',
    sectionSwitch: 'BUTTONS',
    watermark: 'SCREEN',
  },
};

/** The on-screen interface. OMR is a render mode over the same paper, not a scoring change. */
export const TEST_UI = {
  CBT: 'CBT',
  OMR: 'OMR',
  GENERIC: 'GENERIC',
  TYPING: 'TYPING',
} as const;
export const testUiSchema = z.enum(TEST_UI);
export type TestUi = z.infer<typeof testUiSchema>;
export const TEST_UIS = testUiSchema.options;

/** Whether a section counts toward merit or only has to be passed. */
export const MERIT_TYPE = {
  MERIT: 'MERIT',
  QUALIFYING: 'QUALIFYING',
} as const;
export const meritTypeSchema = z.enum(MERIT_TYPE);
export type MeritType = z.infer<typeof meritTypeSchema>;
export const MERIT_TYPES = meritTypeSchema.options;

export const baseConfigModuleSchema = z.object({
  id: z.string(),
  baseConfigId: z.string(),
  name: z.string(),
  order: z.number().int(),
  durationSec: z.number().int().nullable(),
});
export type BaseConfigModule = z.infer<typeof baseConfigModuleSchema>;

export const baseConfigSectionSchema = z.object({
  id: z.string(),
  baseConfigId: z.string(),
  /** Set only when the config is SESSION_MODULE_LOCKED. */
  moduleId: z.string().nullable(),
  name: z.string(),
  order: z.number().int(),
  subjectId: z.string().nullable(),
  questionCount: z.number().int(),
  marksPerQuestion: z.number(),
  /** Per section: one paper may mix them. */
  negativeMarks: z.number(),
  durationSec: z.number().int().nullable(),
  perQuestionSec: z.number().int().nullable(),
  mandatory: z.boolean(),
  meritOrQualifying: meritTypeSchema,
  qualifyingCutoff: z.number().nullable(),
});
export type BaseConfigSection = z.infer<typeof baseConfigSectionSchema>;

/** Enough of a stage to name a config's parent on screen, without a second request. */
export const stageRefSchema = z.object({
  id: z.string(),
  stageKey: z.string(),
  name: z.string(),
  exam: examRefSchema,
});
export type StageRef = z.infer<typeof stageRefSchema>;

export const baseConfigSchema = z.object({
  id: z.string(),
  examStageId: z.string(),
  examStage: stageRefSchema,
  name: z.string(),
  /** The stage's official seeded pattern. There is exactly one. */
  isDefault: z.boolean(),
  /** What this was cloned from — null when it was authored from scratch. */
  clonedFromId: z.string().nullable(),
  version: z.number().int(),
  isActive: z.boolean(),
  /** Trips at the first finalize. Read-only afterwards; clone to evolve. */
  locked: z.boolean(),
  /** A display cache: the sums over the sections. */
  totalQuestions: z.number().int(),
  totalMarks: z.number(),
  durationSec: z.number().int(),
  timerTemplate: timerTemplateSchema,
  navigation: navigationPolicySchema,
  optionalSectionCount: z.number().int().nullable(),
  defaultTestUi: testUiSchema,
  /** The skin a test built from this config starts with. */
  examTemplate: examTemplateSchema,
  languageMode: languageModeSchema,
  languages: z.array(languageCodeSchema),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  calculatorEnabled: z.boolean(),
  /** Which algorithm produced a result, so history can be reproduced exactly. */
  scoringVersion: z.number().int(),
  /** Tests built from it. A locked config with tests is history and cannot be deleted. */
  testCount: z.number().int(),
  createdAt: z.string(),
});
export type BaseConfig = z.infer<typeof baseConfigSchema>;

/** The whole blueprint: the config, its session modules and its sections in order. */
export const baseConfigDetailSchema = baseConfigSchema.extend({
  modules: z.array(baseConfigModuleSchema),
  sections: z.array(baseConfigSectionSchema),
});
export type BaseConfigDetail = z.infer<typeof baseConfigDetailSchema>;

// ============================================================================
// Writing. A config's SHAPE freezes at the first finalize of a test built from
// it — the way to change a locked one is to clone it.
// ============================================================================

export const CONFIG_NAME_MAX = 120;

export const configNameSchema = z
  .string()
  .trim()
  .min(2, 'Give the config a name')
  .max(CONFIG_NAME_MAX, `A name cannot be longer than ${CONFIG_NAME_MAX} characters`);

export const SECTION_NAME_MAX = 80;
export const sectionNameSchema = z
  .string()
  .trim()
  .min(1, 'Give the section a name')
  .max(SECTION_NAME_MAX, `A name cannot be longer than ${SECTION_NAME_MAX} characters`);

/** One section of the paper. `durationSec` is required when the config is SECTIONAL_LOCKED. */
export const baseConfigSectionDraftSchema = z.object({
  name: sectionNameSchema,
  order: z.coerce.number().int().min(0).max(99),
  /** Which module this sits in, BY ORDER — a session paper's only. The modules are new rows on
   *  every save, so there is no id for a draft to point at. */
  moduleOrder: z.coerce.number().int().min(0).max(99).nullish(),
  subjectId: z.string().nullish(),
  questionCount: z.coerce.number().int().min(1).max(500),
  marksPerQuestion: questionMarksSchema,
  /** Per section: one paper may mix them, which is why this is not on the config. */
  negativeMarks: questionMarksSchema,
  durationSec: z.coerce.number().int().min(0).nullish(),
  perQuestionSec: z.coerce.number().int().min(0).nullish(),
  mandatory: z.boolean().optional(),
  meritOrQualifying: meritTypeSchema.optional(),
  qualifyingCutoff: questionMarksSchema.nullish(),
});
export type BaseConfigSectionDraft = z.infer<typeof baseConfigSectionDraftSchema>;
export type BaseConfigSectionDraftInput = z.input<typeof baseConfigSectionDraftSchema>;

/** A session block above the sections. Only SESSION_MODULE_LOCKED configs carry them. */
export const baseConfigModuleDraftSchema = z.object({
  name: z.string().trim().min(1, 'Give the module a name').max(SECTION_NAME_MAX),
  order: z.coerce.number().int().min(0).max(99),
  durationSec: z.coerce.number().int().min(0).nullish(),
});
export type BaseConfigModuleDraft = z.infer<typeof baseConfigModuleDraftSchema>;

/** The shape fields, shared by create and update — everything the lock freezes. */
const configShapeSchema = z.object({
  durationSec: z.coerce.number().int().min(1),
  timerTemplate: timerTemplateSchema.optional(),
  navigation: navigationPolicySchema.optional(),
  optionalSectionCount: z.coerce.number().int().min(0).max(20).nullish(),
  defaultTestUi: testUiSchema.optional(),
  examTemplate: examTemplateSchema.optional(),
  languageMode: languageModeSchema.optional(),
  languages: z.array(languageCodeSchema).optional(),
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  calculatorEnabled: z.boolean().optional(),
});

export const createBaseConfigSchema = configShapeSchema.extend({
  examStageId: z.string().min(1, 'Choose a stage'),
  name: configNameSchema,
  /** A stage holds one default. Promoting this clears the previous one in the same write. */
  isDefault: z.boolean().optional(),
  sections: z.array(baseConfigSectionDraftSchema).min(1, 'A paper needs at least one section'),
  modules: z.array(baseConfigModuleDraftSchema).optional(),
});
export type CreateBaseConfigInput = z.input<typeof createBaseConfigSchema>;
export type CreateBaseConfigBody = z.infer<typeof createBaseConfigSchema>;

/**
 * `sections` and `modules` REPLACE what is there — the editor holds the whole paper, not a delta.
 * Every field here is refused once the config is locked, `name`/`isDefault`/`isActive` excepted:
 * those three are what makes promoting a clone over a locked original possible.
 */
export const updateBaseConfigSchema = configShapeSchema.partial().extend({
  name: configNameSchema.optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sections: z.array(baseConfigSectionDraftSchema).min(1).optional(),
  modules: z.array(baseConfigModuleDraftSchema).optional(),
});
export type UpdateBaseConfigInput = z.input<typeof updateBaseConfigSchema>;
export type UpdateBaseConfigBody = z.infer<typeof updateBaseConfigSchema>;

/** Cloning is how a locked config evolves. The copy starts unlocked and is never the default. */
export const cloneBaseConfigSchema = z.object({
  name: configNameSchema.optional(),
});
export type CloneBaseConfigInput = z.input<typeof cloneBaseConfigSchema>;
export type CloneBaseConfigBody = z.infer<typeof cloneBaseConfigSchema>;

export const baseConfigListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
  examStageId: z.string().optional(),
  examId: csvIdQuery(),
  /** The stage's official pattern, as opposed to a custom one somebody built. */
  defaultOnly: optionalBooleanQuery(),
  activeOnly: optionalBooleanQuery(),
});
export type BaseConfigListQuery = z.infer<typeof baseConfigListQuerySchema>;
export type BaseConfigListQueryInput = z.input<typeof baseConfigListQuerySchema>;

/** The sums a paper has to add up to. Kept on the config as a cache, computed from the sections. */
export function configTotalsOf(sections: readonly BaseConfigSectionDraft[]): {
  totalQuestions: number;
  totalMarks: number;
} {
  return {
    totalQuestions: sections.reduce((sum, section) => sum + section.questionCount, 0),
    totalMarks: sections.reduce(
      (sum, section) => sum + section.questionCount * section.marksPerQuestion,
      0,
    ),
  };
}

export const ADMIN_BASE_CONFIG_ROUTES = {
  list: '/admin/base-configs',
  create: '/admin/base-configs',
  detail: (id: string) => `/admin/base-configs/${id}`,
  update: (id: string) => `/admin/base-configs/${id}`,
  clone: (id: string) => `/admin/base-configs/${id}/clone`,
  remove: (id: string) => `/admin/base-configs/${id}`,
} as const;
