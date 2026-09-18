import { z } from 'zod';

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
  /** How many questions carry this assignment's id — progress against the section's questionCount. */
  writtenCount: z.number().int(),
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
