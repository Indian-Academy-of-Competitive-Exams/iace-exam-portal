import { type ActorType } from '@iace/contracts';

/**
 * What the JWT guard attaches to the request after a token checks out.
 *
 * Lives in `common` rather than in the auth module because every controller
 * names this type on a handler parameter, and a module that needs auth's shared
 * kernel to describe its own method signature is not a module that can be
 * lifted out on its own (docs/03 §4). The auth module PRODUCES it; everyone
 * else merely reads it, which is exactly what belongs in the shared kernel.
 */
export interface AuthenticatedUser {
  id: string;
  actor: ActorType;
  /** Redis session id — the handle a logout revokes. */
  sessionId: string;
  isSuperAdmin: boolean;
  pages: string[];
}
