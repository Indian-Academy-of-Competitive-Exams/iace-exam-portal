import { z } from 'zod';
import { optionalBooleanQuery, searchQuery } from './common';
import { paginationQuerySchema } from './envelope';
import { canonicalNameSchema } from './naming';

// ============================================================================
// Exam types — the catalog `Group.examType` and `Student.enrolledExams` both
// store BY CODE, with no foreign key. Super admin writes only; anyone managing
// groups reads, because they pick from it.
// ============================================================================

export const EXAM_TYPE_NAME_MAX = 80;
export const EXAM_TYPE_CODE_MAX = 40;

/** Display text — what an admin reads in a list, not what anything stores. */
export const examTypeNameSchema = z
  .string()
  .trim()
  .min(2, 'Give the exam type a name')
  .max(EXAM_TYPE_NAME_MAX, `A name cannot be longer than ${EXAM_TYPE_NAME_MAX} characters`);

/** e.g. SSC CGL, RRB JE. Canonical, because groups and enrolments carry this exact string. */
export const examTypeCodeSchema = canonicalNameSchema({
  max: EXAM_TYPE_CODE_MAX,
  label: 'exam type code',
});

export const examTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  isActive: z.boolean(),
  /** Groups pointing at this code — the code cannot change once any exist. */
  groupCount: z.number().int(),
  createdAt: z.string(),
});
export type ExamType = z.infer<typeof examTypeSchema>;

export const examTypeListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
  /** The group and student forms offer active types only; the admin screen shows all. */
  activeOnly: optionalBooleanQuery(),
});
export type ExamTypeListQuery = z.infer<typeof examTypeListQuerySchema>;
export type ExamTypeListQueryInput = z.input<typeof examTypeListQuerySchema>;

export const createExamTypeSchema = z.object({
  name: examTypeNameSchema,
  code: examTypeCodeSchema,
});
export type CreateExamTypeInput = z.input<typeof createExamTypeSchema>;
export type CreateExamTypeBody = z.infer<typeof createExamTypeSchema>;

/** The code is refused server-side once anything references it — see `examTypeEditBlocker`. */
export const updateExamTypeSchema = z.object({
  name: examTypeNameSchema.optional(),
  code: examTypeCodeSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateExamTypeInput = z.input<typeof updateExamTypeSchema>;
export type UpdateExamTypeBody = z.infer<typeof updateExamTypeSchema>;

export const ADMIN_EXAM_TYPE_ROUTES = {
  list: '/admin/exam-types',
  create: '/admin/exam-types',
  update: (id: string) => `/admin/exam-types/${id}`,
  remove: (id: string) => `/admin/exam-types/${id}`,
} as const;
