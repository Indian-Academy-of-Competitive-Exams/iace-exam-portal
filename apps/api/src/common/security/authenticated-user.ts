import { type ActorType, type AdminPermissions } from '@iace/contracts';

/** What the JWT guard attaches to the request after a token checks out. */
export interface AuthenticatedUser {
  id: string;
  actor: ActorType;
  /** Redis session id — the handle a logout revokes. */
  sessionId: string;
  isSuperAdmin: boolean;
  /** False for a deactivated admin, who may sign in but may do nothing. */
  isActive: boolean;
  /** Feature -> level. Empty for a student, and for a super admin, who
   *  bypasses the check entirely — the two are only read together. */
  permissions: AdminPermissions;
  /** Every branch, said out loud — never inferred from an empty `branchIds`. */
  allBranches: boolean;
  /** The branches this admin was given. Empty and `allBranches` false reaches none. */
  branchIds: readonly string[];
}
