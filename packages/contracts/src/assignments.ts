import { z } from 'zod';
import { adminRoleSchema } from './admins';
import { csvIdQuery, optionalBooleanQuery, searchQuery } from './common';
import { paginationQuerySchema } from './envelope';
import { dateOnlySchema } from './students';
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

/** A queue row: an assignment, or a section still needing work that nobody holds — both read alike. */
export const assignmentQueueRowSchema = assignmentWithTestSchema.extend({
  /** Null where nobody has been given the section: there is no row to open, edit or finalize. */
  id: z.string().nullable(),
  assigneeId: z.string().nullable(),
  assigneeName: z.string().nullable(),
});
export type AssignmentQueueRow = z.infer<typeof assignmentQueueRowSchema>;

export const mineAssignmentsQuerySchema = paginationQuerySchema.extend({
  /** Unfinalized only. A super admin's queue is only ever outstanding work, so it ignores this. */
  outstanding: optionalBooleanQuery(),
  /** Absent reads both roles; a role's own queue always sends its own. */
  role: assignmentRoleSchema.optional(),
  /** Matches the test's title. */
  test: searchQuery(),
  /** Matches the section's name. */
  section: searchQuery(),
  /** Institute days, inclusive, against the due date. An unassigned section has none. */
  dueFrom: dateOnlySchema.optional(),
  dueTo: dateOnlySchema.optional(),
  /** Read for a super admin only — nobody else is shown a row that is not their own. */
  assigneeId: csvIdQuery(),
});
export type MineAssignmentsQuery = z.infer<typeof mineAssignmentsQuerySchema>;
export type MineAssignmentsQueryInput = z.input<typeof mineAssignmentsQuerySchema>;

/** id and name only — a picker needs someone to choose, not the directory `admins.list` guards. */
export const assignableAdminSchema = z.object({
  id: z.string(),
  fullName: z.string().nullable(),
  /** What they are called. The feature key is still what decides who is on this list at all. */
  role: adminRoleSchema,
});
export type AssignableAdmin = z.infer<typeof assignableAdminSchema>;

export const assignableQuerySchema = z.object({
  role: assignmentRoleSchema,
});
export type AssignableQuery = z.infer<typeof assignableQuerySchema>;
export type AssignableQueryInput = z.input<typeof assignableQuerySchema>;

// ============================================================================
// The section thread. Comments live at (test, section) — the pair an assignment
// keys on — because the typist and the proof-reader hold separate rows on one
// section and share one discussion. Append-only: nothing edits or deletes one.
// ============================================================================

export const sectionCommentSchema = z.object({
  id: z.string(),
  testId: z.string(),
  baseConfigSectionId: z.string(),
  authorId: z.string(),
  /** Resolved server-side, so a thread reads without a second lookup per line. */
  authorName: z.string(),
  authorRole: adminRoleSchema,
  body: z.string(),
  createdAt: z.string(),
});
export type SectionComment = z.infer<typeof sectionCommentSchema>;

export const createSectionCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(2000),
});
export type CreateSectionCommentInput = z.input<typeof createSectionCommentSchema>;
export type CreateSectionCommentBody = z.infer<typeof createSectionCommentSchema>;

/** Another test holding a question somebody is about to edit — the warning, not a report. */
export const questionOnOtherTestSchema = z.object({
  testId: z.string(),
  testTitle: z.string().nullable(),
  sectionName: z.string(),
  /** Derived: an assignment on that test still carries a null `finalizedAt`. Never stored. */
  underReview: z.boolean(),
  /** Past `min(Test.opensAt, min(TestProgramUnlock.opensAt))`, so students can already reach it. */
  isOpen: z.boolean(),
  opensAt: z.string().nullable(),
});
export type QuestionOnOtherTest = z.infer<typeof questionOnOtherTestSchema>;

export const ADMIN_ASSIGNMENTS_ROUTES = {
  /** GET lists a test's assignments; POST to the same path creates one. */
  forTest: (testId: string) => `/admin/assignments/tests/${testId}`,
  assign: (testId: string) => `/admin/assignments/tests/${testId}`,
  remove: (id: string) => `/admin/assignments/${id}`,
  mine: '/admin/assignments/mine',
  /** One row by id, for the screen a queue row opens — a super admin reaches anybody's. */
  one: (id: string) => `/admin/assignments/${id}`,
  finalize: (id: string) => `/admin/assignments/${id}/finalize`,
  /** Who a role can be given to — active admins already holding the feature key it needs. */
  assignable: '/admin/assignments/assignable',
  /** GET reads the section thread; POST to the same path adds to it. */
  comments: (testId: string, baseConfigSectionId: string) =>
    `/admin/assignments/tests/${testId}/sections/${baseConfigSectionId}/comments`,
} as const;

export const ADMIN_PROOFREADING_ROUTES = {
  /** One section of one test, as the reader assigned to it sees it. */
  forAssignment: (assignmentId: string) =>
    `/admin/proofreading/assignments/${assignmentId}/questions`,
  /** The assignment is in the path because it is the authority the edit rests on. */
  editQuestion: (assignmentId: string, questionId: string) =>
    `/admin/proofreading/assignments/${assignmentId}/questions/${questionId}`,
  /** Read before the edit: which other tests hold this question, and which of them have opened. */
  otherTests: (assignmentId: string, questionId: string) =>
    `/admin/proofreading/assignments/${assignmentId}/questions/${questionId}/other-tests`,
} as const;
