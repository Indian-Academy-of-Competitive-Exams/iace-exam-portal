import { z } from 'zod';
import { optionalBooleanQuery, searchQuery } from './common';
import { paginationQuerySchema } from './envelope';
import { branchNameSchema } from './naming';

// ============================================================================
// Branches — the fixed list of coaching centres a student belongs to. Super
// admin writes only, so whoever assigns one picks a centre rather than typing it.
// ============================================================================

/**
 * PHYSICAL is a coaching centre students attend; VIRTUAL is a branch with no
 * address, which is where every online student sits.
 */
export const BRANCH_TYPE = {
  PHYSICAL: 'PHYSICAL',
  VIRTUAL: 'VIRTUAL',
} as const;
export const branchTypeSchema = z.enum(BRANCH_TYPE);
export type BranchType = z.infer<typeof branchTypeSchema>;
/** The same values as a list, for building a picker without restating them — as `GENDERS` does. */
export const BRANCH_TYPES = branchTypeSchema.options;

export const branchSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: branchTypeSchema,
  isActive: z.boolean(),
  /** Students whose current branch this is — a branch with students cannot be deleted. */
  studentCount: z.number().int(),
  createdAt: z.string(),
});
export type Branch = z.infer<typeof branchSchema>;

/** Just enough to name a branch on screen. */
export const branchRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: branchTypeSchema,
});
export type BranchRef = z.infer<typeof branchRefSchema>;

export const branchListQuerySchema = paginationQuerySchema.extend({
  q: searchQuery(),
  /** Pickers offer active branches only; the admin screen shows all. */
  activeOnly: optionalBooleanQuery(),
});
export type BranchListQuery = z.infer<typeof branchListQuerySchema>;
export type BranchListQueryInput = z.input<typeof branchListQuerySchema>;

export const createBranchSchema = z.object({
  name: branchNameSchema,
  /** Defaulted, so a caller that predates the picker still creates a centre. */
  type: branchTypeSchema.default(BRANCH_TYPE.PHYSICAL),
});
export type CreateBranchInput = z.input<typeof createBranchSchema>;
export type CreateBranchBody = z.infer<typeof createBranchSchema>;

/** Renameable and retirable, never reassigned. Retiring stops new assignments without hiding history. */
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
