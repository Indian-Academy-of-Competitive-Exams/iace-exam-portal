import { z } from 'zod';
import { paginationQuerySchema } from './envelope';
import { branchNameSchema } from './naming';

// ============================================================================
// Branches — the fixed list groups are created under. Super admin writes only,
// so an admin creating a group picks a centre rather than typing one.
// ============================================================================

export const branchSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The one cross-branch branch. Seeded, and refused for deletion. */
  isGlobal: z.boolean(),
  isActive: z.boolean(),
  /** Groups under it — a branch with groups cannot be deleted. */
  groupCount: z.number().int(),
  createdAt: z.string(),
});
export type Branch = z.infer<typeof branchSchema>;

/** Just enough to name the branch a group sits in. */
export const branchRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  isGlobal: z.boolean(),
});
export type BranchRef = z.infer<typeof branchRefSchema>;

export const branchListQuerySchema = paginationQuerySchema.extend({
  q: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  /** Group creation only offers active branches; the admin screen shows all. */
  activeOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});
export type BranchListQuery = z.infer<typeof branchListQuerySchema>;
export type BranchListQueryInput = z.input<typeof branchListQuerySchema>;

export const createBranchSchema = z.object({
  name: branchNameSchema,
});
export type CreateBranchInput = z.input<typeof createBranchSchema>;
export type CreateBranchBody = z.infer<typeof createBranchSchema>;

/** Renameable and retirable, never reassigned. Retiring stops new groups without hiding history. */
export const updateBranchSchema = z.object({
  name: branchNameSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateBranchInput = z.input<typeof updateBranchSchema>;
export type UpdateBranchBody = z.infer<typeof updateBranchSchema>;

export const ADMIN_BRANCH_ROUTES = {
  list: '/admin/branches',
  create: '/admin/branches',
  update: (id: string) => `/admin/branches/${id}`,
  remove: (id: string) => `/admin/branches/${id}`,
} as const;
