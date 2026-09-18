import { z } from 'zod';
import { optionalBooleanQuery } from './common';
import { difficultyMixSchema } from './tests';

// ============================================================================
// Authoring assignments. A section of a test's paper assigned to a typist and
// a proof-reader — a work queue per admin, and a gate on going live: a test
// cannot finalize until every section's assignments are read.
// ============================================================================

export const ASSIGNMENT_ROLES = {
  TYPIST: 'TYPIST',
  PROOFREADER: 'PROOFREADER',
} as const;
const assignmentRoleSchema = z.enum(ASSIGNMENT_ROLES);
export type AssignmentRole = z.infer<typeof assignmentRoleSchema>;

export const assignmentSchema = z.object({
  id: z.string(),
  testId: z.string(),
  baseConfigSectionId: z.string(),
  sectionName: z.string(),
  assigneeId: z.string(),
  assigneeName: z.string(),
  role: assignmentRoleSchema,
  /** An informal reminder. It gates nothing and blocks nothing. */
  dueAt: z.string().nullable(),
  /** The whole state: null is outstanding, set is done. */
  finalizedAt: z.string().nullable(),
  /** Questions written under ANY assignment on this section — a section fact, not this row's own. */
  writtenCount: z.number().int(),
  /** The section's own target — a section fact, same as `writtenCount`. */
  sectionQuestionCount: z.number().int(),
  /** The test's own draw spec for this section. Absent means every difficulty, not zero of each. */
  sectionMix: difficultyMixSchema.nullable(),
});
export type Assignment = z.infer<typeof assignmentSchema>;

export const createAssignmentSchema = z.object({
  baseConfigSectionId: z.string().min(1, 'Choose a section'),
  assigneeId: z.string().min(1, 'Choose an assignee'),
  role: assignmentRoleSchema,
  dueAt: z.string().nullable().optional(),
});
export type CreateAssignmentInput = z.input<typeof createAssignmentSchema>;
export type CreateAssignmentBody = z.infer<typeof createAssignmentSchema>;

/** One row plus the test it is on — a work queue needs that; a section's own list already knows it. */
export const assignmentWithTestSchema = assignmentSchema.extend({
  testTitle: z.string().nullable(),
});
export type AssignmentWithTest = z.infer<typeof assignmentWithTestSchema>;

export const mineAssignmentsQuerySchema = z.object({
  /** Unfinalized only — what a work queue opens to by default. */
  outstanding: optionalBooleanQuery(),
  /** Absent reads both roles; a role's own queue always sends its own. */
  role: assignmentRoleSchema.optional(),
});
export type MineAssignmentsQuery = z.infer<typeof mineAssignmentsQuerySchema>;
export type MineAssignmentsQueryInput = z.input<typeof mineAssignmentsQuerySchema>;

/** id and name only — a picker needs someone to choose, not the directory `admins.list` guards. */
export const assignableAdminSchema = z.object({
  id: z.string(),
  fullName: z.string().nullable(),
});
export type AssignableAdmin = z.infer<typeof assignableAdminSchema>;

export const assignableQuerySchema = z.object({
  role: assignmentRoleSchema,
});
export type AssignableQuery = z.infer<typeof assignableQuerySchema>;
export type AssignableQueryInput = z.input<typeof assignableQuerySchema>;

export const ADMIN_ASSIGNMENTS_ROUTES = {
  /** GET lists a test's assignments; POST to the same path creates one. */
  forTest: (testId: string) => `/admin/assignments/tests/${testId}`,
  assign: (testId: string) => `/admin/assignments/tests/${testId}`,
  remove: (id: string) => `/admin/assignments/${id}`,
  mine: '/admin/assignments/mine',
  finalize: (id: string) => `/admin/assignments/${id}/finalize`,
  /** Who a role can be given to — active admins already holding the feature key it needs. */
  assignable: '/admin/assignments/assignable',
} as const;
