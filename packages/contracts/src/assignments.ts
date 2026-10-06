import { z } from 'zod';
import { adminRoleSchema } from './admins';
import { civilDate, csvIdQuery, optionalBooleanQuery, searchQuery } from './common';
import { paginationQuerySchema } from './envelope';
import { dateOnlySchema, todayISO } from './students';
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
export const assignmentRoleSchema = z.enum(ASSIGNMENT_ROLES);
export type AssignmentRole = z.infer<typeof assignmentRoleSchema>;

/** Where a row stands against its due day, judged in institute days: due on the 9th is on time until the 9th ends. */
export const DUE_STANDINGS = {
  ON_TIME: 'ON_TIME',
  LATE: 'LATE',
  OVERDUE: 'OVERDUE',
} as const;
const dueStandingSchema = z.enum(DUE_STANDINGS);
export type DueStanding = z.infer<typeof dueStandingSchema>;

export const assignmentSchema = z.object({
  id: z.string(),
  testId: z.string(),
  baseConfigSectionId: z.string(),
  sectionName: z.string(),
  assigneeId: z.string(),
  assigneeName: z.string(),
  role: assignmentRoleSchema,
  /** The day it is wanted by; it gates nothing. Null only on a row from before one was required. */
  dueAt: z.string().nullable(),
  /** The whole state: null is outstanding, set is done. */
  finalizedAt: z.string().nullable(),
  /** Against its due day, the server's call. Null where nothing is owed on it, or it is open with the day not over. */
  standing: dueStandingSchema.nullable(),
  /** Seconds its holder has had the section's questions on screen. Null where the viewer is not sent that seat's time. */
  secondsSpent: z.number().int().nullable(),
  /** Questions written under ANY assignment on this section — a section fact, not this row's own. */
  writtenCount: z.number().int(),
  /** The typist's Done would be taken now — the server's gate, so a screen never offers a refused one. */
  canMarkDone: z.boolean(),
  /** The reader's release would be taken now, short of the section being whole and checked. */
  canMarkRead: z.boolean(),
  /** On a proof-reader's row: when the section reached them. Null while it is still with others. */
  handedAt: z.string().nullable(),
  /** Set once the role ended, passed on or its section dropped; the row stays as the record. */
  replacedAt: z.string().nullable(),
  /** The role ended because its section left the test's scope, not because somebody took it over. */
  sectionDropped: z.boolean(),
  /** Nothing has been done under it yet, so it can still be taken back. Null where not asked. */
  removable: z.boolean().nullable(),
  /** The test has been offered: its paper is frozen, and no section of it is anybody's to change. */
  testOffered: z.boolean(),
  /** The section's own target — a section fact, same as `writtenCount`. */
  sectionQuestionCount: z.number().int(),
  /** The test's own draw spec for this section. Absent means every difficulty, not zero of each. */
  sectionMix: difficultyMixSchema.nullable(),
  /** The subject the SECTION names. Null where the base config left it open, and then only then. */
  sectionSubjectId: z.string().nullable(),
});
export type Assignment = z.infer<typeof assignmentSchema>;

export const createAssignmentSchema = z.object({
  baseConfigSectionId: z.string().min(1, 'Choose a section'),
  assigneeId: z.string().min(1, 'Choose an assignee'),
  role: assignmentRoleSchema,
  dueAt: z.string().min(1, 'Choose a due date').pipe(dateOnlySchema),
});
export type CreateAssignmentInput = z.input<typeof createAssignmentSchema>;
export type CreateAssignmentBody = z.infer<typeof createAssignmentSchema>;

/** One row plus the test it is on — a work queue needs that; a section's own list already knows it. */
export const assignmentWithTestSchema = assignmentSchema.extend({
  testTitle: z.string().nullable(),
  /** The reader's release would be taken now: reading open, the section whole and every question checked. */
  canRelease: z.boolean(),
});
export type AssignmentWithTest = z.infer<typeof assignmentWithTestSchema>;

export const mineAssignmentsQuerySchema = paginationQuerySchema.extend({
  /** Unfinalized only. */
  outstanding: optionalBooleanQuery(),
  /** Absent reads both roles; a role's own queue always sends its own. */
  role: assignmentRoleSchema.optional(),
  /** The test chosen in the queue's picker; its sections are what `baseConfigSectionId` narrows. */
  testId: z.string().optional(),
  baseConfigSectionId: z.string().optional(),
  /** Institute days, inclusive, against the due date. */
  dueFrom: dateOnlySchema.optional(),
  dueTo: dateOnlySchema.optional(),
});
export type MineAssignmentsQuery = z.infer<typeof mineAssignmentsQuerySchema>;
export type MineAssignmentsQueryInput = z.input<typeof mineAssignmentsQuerySchema>;

/** A typist's Done: exactly the section's questions for the paper; the rest go to the bank unless discarded. */
export const typistDoneSchema = z.object({
  selected: z.array(z.string()).min(1, 'Choose the questions for this section'),
  discard: z.array(z.string()).default([]),
});
export type TypistDoneInput = z.input<typeof typistDoneSchema>;
export type TypistDoneBody = z.infer<typeof typistDoneSchema>;

/** Null where there is nothing to judge: no due day, or still open with the day not yet over. */
export function dueStanding(
  row: { dueAt: Date | string | null; finalizedAt: Date | string | null },
  today: string = todayISO(),
): DueStanding | null {
  if (row.dueAt === null) return null;
  const due = civilDate(new Date(row.dueAt));
  if (row.finalizedAt === null) return today > due ? DUE_STANDINGS.OVERDUE : null;
  return civilDate(new Date(row.finalizedAt)) > due ? DUE_STANDINGS.LATE : DUE_STANDINGS.ON_TIME;
}

/** How many open sections a summary names, soonest due first. */
export const ASSIGNMENT_SUMMARY_NEXT_ROWS = 5;

/** One role's standing across the sections its holder has now. */
const assignmentRoleSummarySchema = z.object({
  role: assignmentRoleSchema,
  assigned: z.number().int(),
  completed: z.number().int(),
  /** Completed by the end of its due day. A row with no due day counts in neither this nor `overdue`. */
  onTime: z.number().int(),
  /** Still owed past its due day. */
  overdue: z.number().int(),
  secondsSpent: z.number().int(),
});
export type AssignmentRoleSummary = z.infer<typeof assignmentRoleSummarySchema>;

const assignmentSummaryRowSchema = z.object({
  assignmentId: z.string(),
  testId: z.string(),
  testTitle: z.string().nullable(),
  baseConfigSectionId: z.string(),
  sectionName: z.string(),
  role: assignmentRoleSchema,
  dueAt: z.string().nullable(),
  standing: dueStandingSchema.nullable(),
  secondsSpent: z.number().int(),
});
export type AssignmentSummaryRow = z.infer<typeof assignmentSummaryRowSchema>;

/** One admin's own typing and proof-reading: a role they hold nothing under is left out. */
export const assignmentSummarySchema = z.object({
  roles: z.array(assignmentRoleSummarySchema),
  /** The sections still owed, soonest due first. */
  next: z.array(assignmentSummaryRowSchema),
});
export type AssignmentSummary = z.infer<typeof assignmentSummarySchema>;

// ============================================================================
// Section progress. A super admin's read-only view of how the institute's
// typing and proof-reading are going: one row per (test, section) whether or
// not anybody holds it and whether or not it is finished. No actions live here.
// ============================================================================

/** One role's standing on one section. */
const sectionRoleProgressSchema = z.object({
  /** Null where nobody has been given the section: there is nothing to open. */
  assignmentId: z.string().nullable(),
  assigneeId: z.string().nullable(),
  assigneeName: z.string().nullable(),
  dueAt: z.string().nullable(),
  finalizedAt: z.string().nullable(),
  standing: dueStandingSchema.nullable(),
  /** Seconds its holder has had the section's questions on screen; zero where nobody holds it. */
  secondsSpent: z.number().int(),
});
export type SectionRoleProgress = z.infer<typeof sectionRoleProgressSchema>;

export const sectionProgressRowSchema = z.object({
  testId: z.string(),
  testTitle: z.string().nullable(),
  baseConfigSectionId: z.string(),
  sectionName: z.string(),
  /** Questions written under ANY assignment on this section, against the section's own target. */
  writtenCount: z.number().int(),
  sectionQuestionCount: z.number().int(),
  /** Null where the paper's source gives the role nothing to do — a PICKED test is never typed. */
  typing: sectionRoleProgressSchema.nullable(),
  reading: sectionRoleProgressSchema.nullable(),
});
export type SectionProgressRow = z.infer<typeof sectionProgressRowSchema>;

export const sectionProgressQuerySchema = paginationQuerySchema.extend({
  /** The test chosen in the picker; its sections are what `baseConfigSectionId` narrows. */
  testId: z.string().optional(),
  baseConfigSectionId: z.string().optional(),
  /** Institute days, inclusive, against EITHER role's due date. */
  dueFrom: dateOnlySchema.optional(),
  dueTo: dateOnlySchema.optional(),
  /** Matches a section EITHER of whose roles one of them holds. */
  assigneeId: csvIdQuery(),
});
export type SectionProgressQuery = z.infer<typeof sectionProgressQuerySchema>;
export type SectionProgressQueryInput = z.input<typeof sectionProgressQuerySchema>;

// ============================================================================
// What the queue and the progress screen CHOOSE from. A test picker pages and
// searches on the server; its sections then fill a plain dropdown, because a
// base config holds a dozen of them and never a page's worth.
// ============================================================================

/** Enough to choose a test by, and no more: a picker names one, it does not describe it. */
export const assignmentTestSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
});
export type AssignmentTest = z.infer<typeof assignmentTestSchema>;

export const assignmentSectionSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type AssignmentSection = z.infer<typeof assignmentSectionSchema>;

/** `mine` is how a super admin asks for their OWN queue rather than the whole institute's. */
const assignmentScopeShape = {
  role: assignmentRoleSchema.optional(),
  mine: optionalBooleanQuery(),
};

export const assignmentTestsQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
  ...assignmentScopeShape,
});
export type AssignmentTestsQuery = z.infer<typeof assignmentTestsQuerySchema>;
export type AssignmentTestsQueryInput = z.input<typeof assignmentTestsQuerySchema>;

export const assignmentSectionsQuerySchema = z.object(assignmentScopeShape);
export type AssignmentSectionsQuery = z.infer<typeof assignmentSectionsQuerySchema>;
export type AssignmentSectionsQueryInput = z.input<typeof assignmentSectionsQuerySchema>;

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
// section and share one discussion. An author may reword their own; every
// earlier wording stays on the same row, so the thread still reads as a record.
// ============================================================================

/** What a message said before it was reworded. Oldest first; the current body is never here. */
const commentRevisionSchema = z.object({
  body: z.string(),
  at: z.string(),
});
export type CommentRevision = z.infer<typeof commentRevisionSchema>;

/** At most this many images on one message — a thread is a conversation, not an album. */
export const COMMENT_MAX_IMAGES = 6;

export const sectionCommentSchema = z.object({
  id: z.string(),
  testId: z.string(),
  baseConfigSectionId: z.string(),
  authorId: z.string(),
  /** Resolved server-side, so a thread reads without a second lookup per line. */
  authorName: z.string(),
  authorRole: adminRoleSchema,
  body: z.string(),
  /** Signed download URLs, not the stored keys — the same treatment a question's images get. */
  images: z.string().array(),
  /** Null until it is reworded, and then the last time it was. */
  editedAt: z.string().nullable(),
  revisions: commentRevisionSchema.array(),
  createdAt: z.string(),
});
export type SectionComment = z.infer<typeof sectionCommentSchema>;

/** A message is text, images, or both — an empty one with no picture is nothing said. */
export const createSectionCommentSchema = z
  .object({
    body: z.string().trim().max(2000).default(''),
    /** Storage keys from the image upload, in the order they should read. */
    images: z.string().array().max(COMMENT_MAX_IMAGES).default([]),
  })
  .refine((input) => input.body !== '' || input.images.length > 0, {
    message: 'Write something, or add a picture',
    path: ['body'],
  });
export type CreateSectionCommentInput = z.input<typeof createSectionCommentSchema>;
export type CreateSectionCommentBody = z.infer<typeof createSectionCommentSchema>;

/** Words only: a thread reads back signed URLs, never the keys, so its pictures cannot be resent. */
export const editSectionCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write something first').max(2000),
});
export type EditSectionCommentInput = z.input<typeof editSectionCommentSchema>;
export type EditSectionCommentBody = z.infer<typeof editSectionCommentSchema>;

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
  remove: (testId: string, id: string) => `/admin/assignments/tests/${testId}/${id}`,
  mine: '/admin/assignments/mine',
  /** Read access over every section, for a super admin. Assigned or not, finished or not. */
  progress: '/admin/assignments/progress',
  /** What a test picker offers: their own tests, or every unfrozen one for a super admin. */
  tests: '/admin/assignments/tests',
  /** The chosen test's sections, unpaged — a base config holds a dozen, never a page's worth. */
  sectionsOf: (testId: string) => `/admin/assignments/tests/${testId}/sections`,
  /** Who a role can be given to — active admins already holding the feature key it needs. */
  assignable: '/admin/assignments/assignable',
} as const;
