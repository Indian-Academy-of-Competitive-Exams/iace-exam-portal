import { z } from 'zod';
import { optionalBooleanQuery, searchQuery } from './common';
import { paginationQuerySchema } from './envelope';
import { canonicalNameSchema } from './naming';

// ============================================================================
// Exam taxonomy — Family → Exam → Stage. The stage is the level that carries a
// base config, a series and a test; nothing attaches to an exam directly.
// ============================================================================

/** A fixed set, not a table. Onboarding a new family is a migration. */
export const EXAM_FAMILY = {
  SSC: 'SSC',
  RRB: 'RRB',
  BANKING: 'BANKING',
  AP_TS_POLICE: 'AP_TS_POLICE',
} as const;
export const examFamilySchema = z.enum(EXAM_FAMILY);
export type ExamFamily = z.infer<typeof examFamilySchema>;
export const EXAM_FAMILIES = examFamilySchema.options;

/** How a stage is delivered. Only CBT and OMR are scorable here. */
export const EXAM_MODE = {
  CBT: 'CBT',
  OMR: 'OMR',
  PSYCHOMETRIC: 'PSYCHOMETRIC',
  SKILL: 'SKILL',
  PHYSICAL: 'PHYSICAL',
  INTERVIEW: 'INTERVIEW',
  DESCRIPTIVE: 'DESCRIPTIVE',
} as const;
export const examModeSchema = z.enum(EXAM_MODE);
export type ExamMode = z.infer<typeof examModeSchema>;
export const EXAM_MODES = examModeSchema.options;

/** Whether a stage can carry a mock at all. Only CONDUCTED and PARTIAL get configs. */
export const STAGE_DISPOSITION = {
  /** Pure objective CBT or OMR — a full mock, auto-scored. */
  CONDUCTED: 'CONDUCTED',
  /** Compound: the objective part is sat, the descriptive or skill part is not. */
  PARTIAL: 'PARTIAL',
  /** Listed so the journey is complete on screen, never run. */
  CATALOG_ONLY: 'CATALOG_ONLY',
} as const;
export const stageDispositionSchema = z.enum(STAGE_DISPOSITION);
export type StageDisposition = z.infer<typeof stageDispositionSchema>;
export const STAGE_DISPOSITIONS = stageDispositionSchema.options;

/**
 * The language values a config, an attempt and a student's preference are STORED as.
 * Not `SUPPORTED_LANGUAGES` in ./questions, which is the lowercase key set used inside
 * question content JSON — same three languages, different spelling, and mixing them
 * writes a value no column will match. The two are reconciled when versioning lands.
 */
export const LANGUAGE_CODE = {
  EN: 'EN',
  HI: 'HI',
  TE: 'TE',
} as const;
export const languageCodeSchema = z.enum(LANGUAGE_CODE);
export type LanguageCode = z.infer<typeof languageCodeSchema>;
export const LANGUAGE_CODES = languageCodeSchema.options;

export const EXAM_NAME_MAX = 80;
export const EXAM_CODE_MAX = 40;

/** Display text — what an admin reads in a list, not what anything stores. */
export const examNameSchema = z
  .string()
  .trim()
  .min(2, 'Give the exam a name')
  .max(EXAM_NAME_MAX, `A name cannot be longer than ${EXAM_NAME_MAX} characters`);

/** e.g. SSC CGL, RRB JE. Canonical, because enrolments carry this exact string. */
export const examCodeSchema = canonicalNameSchema({ max: EXAM_CODE_MAX, label: 'exam code' });

export const examSchema = z.object({
  id: z.string(),
  family: examFamilySchema,
  /** What `Student.enrolledExams` holds, so it is never reused for another exam. */
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  /** Stages under it — an exam with stages cannot be deleted. */
  stageCount: z.number().int(),
  createdAt: z.string(),
});
export type Exam = z.infer<typeof examSchema>;

export const examListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
  family: examFamilySchema.optional(),
  /** Pickers offer active exams only; the admin screen shows all. */
  activeOnly: optionalBooleanQuery(),
});
export type ExamListQuery = z.infer<typeof examListQuerySchema>;
export type ExamListQueryInput = z.input<typeof examListQuerySchema>;

export const createExamSchema = z.object({
  family: examFamilySchema,
  code: examCodeSchema,
  name: examNameSchema,
  description: z.string().trim().max(500).optional(),
});
export type CreateExamInput = z.input<typeof createExamSchema>;
export type CreateExamBody = z.infer<typeof createExamSchema>;

/** The code is refused server-side once an enrolment stores it — see `examEditBlocker`. */
export const updateExamSchema = z.object({
  family: examFamilySchema.optional(),
  code: examCodeSchema.optional(),
  name: examNameSchema.optional(),
  description: z.string().trim().max(500).nullish(),
  isActive: z.boolean().optional(),
});
export type UpdateExamInput = z.input<typeof updateExamSchema>;
export type UpdateExamBody = z.infer<typeof updateExamSchema>;

export const ADMIN_EXAM_ROUTES = {
  list: '/admin/exams',
  create: '/admin/exams',
  update: (id: string) => `/admin/exams/${id}`,
  remove: (id: string) => `/admin/exams/${id}`,
} as const;

export const ADMIN_EXAM_STAGE_ROUTES = {
  list: '/admin/exam-stages',
  create: '/admin/exam-stages',
  update: (id: string) => `/admin/exam-stages/${id}`,
  remove: (id: string) => `/admin/exam-stages/${id}`,
} as const;

export const STAGE_NAME_MAX = 80;
export const STAGE_KEY_MAX = 60;

export const stageNameSchema = z
  .string()
  .trim()
  .min(2, 'Give the stage a name')
  .max(STAGE_NAME_MAX, `A name cannot be longer than ${STAGE_NAME_MAX} characters`);

/**
 * Human-stable and unique across every exam — "SSC_CGL_T1". Underscores, not spaces: this is
 * what the exam-pattern workbook and every seed script address a stage by.
 */
export const stageKeySchema = z
  .string()
  .transform((value) =>
    value
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_'),
  )
  .pipe(
    z
      .string()
      .min(2, 'Give the stage a key')
      .max(STAGE_KEY_MAX, `A key cannot be longer than ${STAGE_KEY_MAX} characters`)
      .regex(/^[A-Z][A-Z0-9_]*$/, 'Use capital letters, numbers and underscores'),
  );

/** Enough of an exam to name the stage's parent on screen, without a second request. */
export const examRefSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  family: examFamilySchema,
});
export type ExamRef = z.infer<typeof examRefSchema>;

export const examStageSchema = z.object({
  id: z.string(),
  examId: z.string(),
  exam: examRefSchema,
  /** Human-stable, from the exam-pattern workbook — "SSC_CGL_T1". */
  stageKey: z.string(),
  name: z.string(),
  order: z.number().int(),
  mode: examModeSchema,
  disposition: stageDispositionSchema,
  isActive: z.boolean(),
  /** What hangs off the stage. Any of them refuses a delete — retire it instead. */
  configCount: z.number().int(),
  testCount: z.number().int(),
  seriesCount: z.number().int(),
  createdAt: z.string(),
});
export type ExamStage = z.infer<typeof examStageSchema>;

export const examStageListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
  examId: z.string().optional(),
  family: examFamilySchema.optional(),
  disposition: stageDispositionSchema.optional(),
  activeOnly: optionalBooleanQuery(),
});
export type ExamStageListQuery = z.infer<typeof examStageListQuerySchema>;
export type ExamStageListQueryInput = z.input<typeof examStageListQuerySchema>;

export const createExamStageSchema = z.object({
  examId: z.string().min(1, 'Choose an exam'),
  stageKey: stageKeySchema,
  name: stageNameSchema,
  /** Where it sits in the journey. Ties are broken by name, so a shared order is not an error. */
  order: z.coerce.number().int().min(0).max(99).optional(),
  mode: examModeSchema.optional(),
  disposition: stageDispositionSchema.optional(),
});
export type CreateExamStageInput = z.input<typeof createExamStageSchema>;
export type CreateExamStageBody = z.infer<typeof createExamStageSchema>;

/** A stage never moves exam — every config, series and test under it would change meaning. */
export const updateExamStageSchema = z.object({
  stageKey: stageKeySchema.optional(),
  name: stageNameSchema.optional(),
  order: z.coerce.number().int().min(0).max(99).optional(),
  mode: examModeSchema.optional(),
  disposition: stageDispositionSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateExamStageInput = z.input<typeof updateExamStageSchema>;
export type UpdateExamStageBody = z.infer<typeof updateExamStageSchema>;

/** Only these two carry a mock. CATALOG_ONLY is listed so the journey reads whole. */
export function stageTakesConfigs(disposition: StageDisposition): boolean {
  return disposition !== STAGE_DISPOSITION.CATALOG_ONLY;
}
