import { z } from 'zod';
import { branchRefSchema } from './branches';
import { optionalBooleanQuery, searchQuery } from './common';
import { paginationQuerySchema } from './envelope';
import { examTypeCodeSchema } from './exam-types';
import { groupNameSchema } from './naming';

// ============================================================================
// Groups — the access unit: Student -> Group -> TestSeries -> Test. How a group
// finds its students is decided by its TYPE: an enrolment matching its exam
// code, the whole roster, or a grant made student by student. Name unique
// within the exam code.
// ============================================================================

/**
 * How a group reaches its students. GLOBAL is the singleton everybody is in;
 * EXAM and PROGRAM are reached by an enrolment matching `examType`; SCHOLARSHIP
 * and NON_IACE are granted student by student.
 */
export const GROUP_TYPE = {
  GLOBAL: 'GLOBAL',
  EXAM: 'EXAM',
  PROGRAM: 'PROGRAM',
  SCHOLARSHIP: 'SCHOLARSHIP',
  NON_IACE: 'NON_IACE',
} as const;
export const groupTypeSchema = z.enum(GROUP_TYPE);
export type GroupType = z.infer<typeof groupTypeSchema>;

/** `SSC CGL / SSC CGL MORNING` — qualified where a code exists, bare where none does. */
export function qualifiedGroupName(group: { name: string; examType: string | null }): string {
  return group.examType ? `${group.examType} / ${group.name}` : group.name;
}

export const DEACTIVATED_MEMBER_MESSAGE =
  'That student is blocked from tests. Lift the block before granting them a group.';

/**
 * A student blocked from tests keeps the groups they are in but gains none: a group is a
 * route to a test. Counted over the students JOINING, never everyone named.
 */
export function deactivatedMemberBlocker(blockedCount: number): string | null {
  if (blockedCount < 1) return null;
  if (blockedCount === 1) return DEACTIVATED_MEMBER_MESSAGE;
  return `${blockedCount} of those students are blocked from tests. Lift the block before granting them a group.`;
}

/** The two types a student is put into one at a time. Every other type is reached by who they are. */
export const GROUP_TYPES_ACCEPTING_GRANTS = [GROUP_TYPE.SCHOLARSHIP, GROUP_TYPE.NON_IACE] as const;

/** EXAM and PROGRAM are reached by an enrolment, so both carry the code that enrolment matches. */
export const GROUP_TYPES_REQUIRING_EXAM = [GROUP_TYPE.EXAM, GROUP_TYPE.PROGRAM] as const;

/** GLOBAL is seeded by a migration and is never created again. */
export const CREATABLE_GROUP_TYPES = [
  GROUP_TYPE.EXAM,
  GROUP_TYPE.PROGRAM,
  GROUP_TYPE.SCHOLARSHIP,
  GROUP_TYPE.NON_IACE,
] as const;

export function acceptsDirectGrants(type: GroupType): boolean {
  return (GROUP_TYPES_ACCEPTING_GRANTS as readonly GroupType[]).includes(type);
}

export function requiresExamType(type: GroupType): boolean {
  return (GROUP_TYPES_REQUIRING_EXAM as readonly GroupType[]).includes(type);
}

export const DIRECT_GRANT_MESSAGE =
  'Students reach this group through their enrolment, so they cannot be added to it one at a time.';

export const EXAM_TYPE_REQUIRED_MESSAGE = 'Pick the exam this group is for';
export const EXAM_TYPE_NOT_ALLOWED_MESSAGE =
  'This group is granted student by student, so it is not tied to an exam';
export const BRANCH_REQUIRED_MESSAGE = 'Pick at least one branch';
export const GLOBAL_GROUP_UNCREATABLE_MESSAGE =
  'The all-students group already exists — it is never created again';

/** How a group finds its students. The count, the roster filter and the resolver must agree. */
export const GROUP_REACH = {
  ENROLMENT: 'ENROLMENT',
  EVERYONE: 'EVERYONE',
  GRANT: 'GRANT',
} as const;
export type GroupReach = (typeof GROUP_REACH)[keyof typeof GROUP_REACH];

export function groupReach(group: { type: GroupType; examType: string | null }): GroupReach {
  if (group.type === GROUP_TYPE.GLOBAL) return GROUP_REACH.EVERYONE;
  if (requiresExamType(group.type) && group.examType) return GROUP_REACH.ENROLMENT;
  return GROUP_REACH.GRANT;
}

export interface GroupShapeIssue {
  path: 'examType' | 'branchIds';
  message: string;
}

/** What a type demands of the rest of the body. `undefined` is "not being set", so a patch skips it. */
export function groupShapeIssue(input: {
  type: GroupType;
  examType?: string | null;
  branchIds?: readonly string[];
}): GroupShapeIssue | null {
  if (requiresExamType(input.type)) {
    if (input.examType !== undefined && !input.examType)
      return { path: 'examType', message: EXAM_TYPE_REQUIRED_MESSAGE };
    if (input.branchIds?.length === 0)
      return { path: 'branchIds', message: BRANCH_REQUIRED_MESSAGE };
    return null;
  }
  if (input.examType) return { path: 'examType', message: EXAM_TYPE_NOT_ALLOWED_MESSAGE };
  return null;
}

export const groupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: groupTypeSchema,
  /** The ExamType code this group's name is unique within, where it has one. */
  examType: z.string().nullable(),
  isActive: z.boolean(),
  /** The centres offering it — empty for a group that belongs to no centre. */
  branches: z.array(branchRefSchema),
  description: z.string().nullable(),
  studentCount: z.number().int(),
  /** How many test series this group grants — 0 means it grants nothing yet. */
  testSeriesCount: z.number().int(),
  createdAt: z.string(),
});
export type GroupSummary = z.infer<typeof groupSummarySchema>;

export const groupListQuerySchema = paginationQuerySchema.extend({
  /** Matches a group name or a branch, case-insensitively. */
  q: searchQuery(),
  branchId: z.string().optional(),
  /** Only the types a student can be granted one of, one student at a time. */
  acceptsGrants: optionalBooleanQuery(),
});
export type GroupListQuery = z.infer<typeof groupListQuerySchema>;
export type GroupListQueryInput = z.input<typeof groupListQuerySchema>;

export const createGroupSchema = z
  .object({
    name: groupNameSchema,
    type: groupTypeSchema,
    examType: examTypeCodeSchema.optional(),
    branchIds: z.array(z.string().min(1)).default([]),
    description: z.string().trim().max(500).nullish(),
  })
  .superRefine((input, ctx) => {
    if (!(CREATABLE_GROUP_TYPES as readonly GroupType[]).includes(input.type)) {
      ctx.addIssue({ code: 'custom', path: ['type'], message: GLOBAL_GROUP_UNCREATABLE_MESSAGE });
      return;
    }
    const issue = groupShapeIssue({
      type: input.type,
      examType: input.examType ?? null,
      branchIds: input.branchIds,
    });
    if (issue) ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
  });
export type CreateGroupInput = z.input<typeof createGroupSchema>;
export type CreateGroupBody = z.infer<typeof createGroupSchema>;

/** `type` is absent on purpose: retyping a group silently changes who reaches it. */
export const updateGroupSchema = z.object({
  name: groupNameSchema.optional(),
  examType: examTypeCodeSchema.optional(),
  branchIds: z.array(z.string().min(1)).optional(),
  description: z.string().trim().max(500).nullish(),
  isActive: z.boolean().optional(),
});
export type UpdateGroupInput = z.input<typeof updateGroupSchema>;
export type UpdateGroupBody = z.infer<typeof updateGroupSchema>;

/** Adding is a set operation: re-adding a student already in the group is a no-op. */
export const addGroupMembersSchema = z.object({
  studentIds: z.array(z.string()).min(1, 'Pick at least one student'),
});
export type AddGroupMembersInput = z.input<typeof addGroupMembersSchema>;
export type AddGroupMembersBody = z.infer<typeof addGroupMembersSchema>;

/** What an add actually did — re-adds are silent, so say so rather than imply it. */
export const addGroupMembersResultSchema = z.object({
  added: z.number().int(),
  alreadyMembers: z.number().int(),
});
export type AddGroupMembersResult = z.infer<typeof addGroupMembersResultSchema>;

export const ADMIN_GROUP_ROUTES = {
  list: '/admin/groups',
  create: '/admin/groups',
  detail: (id: string) => `/admin/groups/${id}`,
  update: (id: string) => `/admin/groups/${id}`,
  remove: (id: string) => `/admin/groups/${id}`,
  addMembers: (id: string) => `/admin/groups/${id}/students`,
  removeMember: (id: string, studentId: string) => `/admin/groups/${id}/students/${studentId}`,
  /** Members are read through the student list, which already pages and searches. */
  members: (id: string) => `/admin/students?groupId=${id}`,
} as const;
