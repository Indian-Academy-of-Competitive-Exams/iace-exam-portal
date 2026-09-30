import { type ActorType, type AdminAuthority } from '@iace/contracts';

/** What the JWT guard attaches to the request after a token checks out — exactly what `can()` reads, plus who it is. */
export interface AuthenticatedUser extends AdminAuthority {
  id: string;
  actor: ActorType;
  /** Redis session id — the handle a logout revokes. */
  sessionId: string;
}
