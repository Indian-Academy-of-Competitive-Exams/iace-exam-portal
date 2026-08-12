import { z } from 'zod';
import { paginationQuerySchema } from './envelope';

// ============================================================================
// Groups — the access unit.
//
// Access runs Student → Group → TestSeries → Test, so a group is not a label:
// it is the only thing that decides which tests a student can reach. Two rules
// here follow directly from that, and both are enforced server-side:
//
//   - a student must remain in at least one group, or they can reach nothing;
//   - a group that still has students, or is still linked to a test series,
//     cannot be deleted — removing it would revoke access silently.
// ============================================================================

export const groupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  branch: z.string().nullable(),
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
});
export type GroupListQuery = z.infer<typeof groupListQuerySchema>;
export type GroupListQueryInput = z.input<typeof groupListQuerySchema>;

export const createGroupSchema = z.object({
  name: z.string().trim().min(2, 'Give the group a name').max(80),
  branch: z.string().trim().max(80).nullish(),
  description: z.string().trim().max(500).nullish(),
});
export type CreateGroupInput = z.input<typeof createGroupSchema>;
export type CreateGroupBody = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = createGroupSchema.partial();
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
