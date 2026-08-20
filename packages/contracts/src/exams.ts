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

export const examStageSchema = z.object({
  id: z.string(),
  examId: z.string(),
  /** Human-stable, from the exam-pattern workbook — "SSC_CGL_T1". */
  stageKey: z.string(),
  name: z.string(),
  order: z.number().int(),
  mode: examModeSchema,
  disposition: stageDispositionSchema,
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type ExamStage = z.infer<typeof examStageSchema>;
