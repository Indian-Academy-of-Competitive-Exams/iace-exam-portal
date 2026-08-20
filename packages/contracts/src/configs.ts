import { z } from 'zod';
import { languageCodeSchema } from './exams';

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

export const baseConfigSchema = z.object({
  id: z.string(),
  examStageId: z.string(),
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
  languageMode: languageModeSchema,
  languages: z.array(languageCodeSchema),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  calculatorEnabled: z.boolean(),
  /** Which algorithm produced a result, so history can be reproduced exactly. */
  scoringVersion: z.number().int(),
  createdAt: z.string(),
});
export type BaseConfig = z.infer<typeof baseConfigSchema>;
