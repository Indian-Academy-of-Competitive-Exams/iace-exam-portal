import { z } from 'zod';
import { paginationQuerySchema } from './envelope';
import { branchNameSchema } from './naming';

// ============================================================================
// Branches — the fixed list groups are created under.
//
// Only a super admin writes here. That is the whole point: the list moves
// rarely, and the admin creating a group picks from it rather than typing a
// centre name and hoping it matches what someone else typed last year.
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

/**
 * A branch is renameable and can be retired, but never reassigned — its groups
 * move with it, so renaming is how a centre changes what it is called.
 * Deactivating keeps history readable while stopping new groups being made
 * under a centre that has closed.
 */
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
