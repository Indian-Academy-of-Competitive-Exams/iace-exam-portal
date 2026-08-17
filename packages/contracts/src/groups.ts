import { z } from 'zod';
import { branchRefSchema } from './branches';
import { paginationQuerySchema } from './envelope';
import { groupNameSchema } from './naming';

// ============================================================================
// Groups — the access unit: Student -> Group -> TestSeries -> Test. Enforced
// server-side: a student stays in at least one group, a deactivated student
// gains no new one, and a group with students or a series cannot be deleted.
// One branch each, name unique within it.
// ============================================================================

export const DEACTIVATED_MEMBER_MESSAGE =
  'That student is deactivated. Reactivate them before adding them to a group.';

/**
 * A deactivated student keeps the groups they are in but gains none: a group is a route
 * to a test. Counted over the students JOINING, never everyone named.
 */
export function deactivatedMemberBlocker(deactivatedCount: number): string | null {
  if (deactivatedCount < 1) return null;
  if (deactivatedCount === 1) return DEACTIVATED_MEMBER_MESSAGE;
  return `${deactivatedCount} of those students are deactivated. Reactivate them before adding them to a group.`;
}

export const groupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  branch: branchRefSchema,
  description: z.string().nullable(),
  studentCount: z.number().int(),
  /** How many test series this group grants — 0 means it grants nothing yet. */
  testSeriesCount: z.number().int(),
  createdAt: z.string(),
});
export type GroupSummary = z.infer<typeof groupSummarySchema>;

export const groupListQuerySchema = paginationQuerySchema.extend({
  /** Matches a group name or a branch, case-insensitively. */
  q: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  branchId: z.string().optional(),
});
export type GroupListQuery = z.infer<typeof groupListQuerySchema>;
export type GroupListQueryInput = z.input<typeof groupListQuerySchema>;

export const createGroupSchema = z.object({
  name: groupNameSchema,
  branchId: z.string().min(1, 'Pick a branch'),
  description: z.string().trim().max(500).nullish(),
});
export type CreateGroupInput = z.input<typeof createGroupSchema>;
export type CreateGroupBody = z.infer<typeof createGroupSchema>;

/** Renameable, never moved between branches — the branch is half of its uniqueness. */
export const updateGroupSchema = createGroupSchema.omit({ branchId: true }).partial();
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
