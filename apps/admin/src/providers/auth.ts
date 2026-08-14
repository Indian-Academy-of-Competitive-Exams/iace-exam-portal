import {
  ActorTypes,
  PERMISSION_LEVELS,
  satisfiesLevel,
  type AdminIdentity,
  type PermissionLevel,
} from '@iace/contracts';
import { createAuth } from '@iace/app-kit';
import { api, signOutSignal, tokenStore } from '../lib/api';
import { ME_QUERY_KEY } from '../lib/constants';

/**
 * This app's session. All of the behaviour is in `createAuth`; what is here is
 * the three things that are genuinely this app's — which actor counts as a
 * session, where its identity is cached, and which client it reads through —
 * plus one read that only makes sense for an admin.
 *
 * `ActorTypes.ADMIN` is doing real work: a student's token is a perfectly valid
 * JWT and must not be a session in the admin app. The server enforces the same
 * split with `@Actors`.
 */
export const { AuthProvider, useAuth } = createAuth<
  AdminIdentity,
  { can: (key: string, level?: PermissionLevel) => boolean }
>({
  actor: ActorTypes.ADMIN,
  queryKey: ME_QUERY_KEY,
  tokenStore,
  signOutSignal,
  endpoints: {
    me: () => api.auth.me(),
    logout: async () => {
      await api.auth.logout();
    },
  },
  /**
   * Mirrors the server-side FeaturePermissionGuard exactly, and shares the rule
   * with it: `satisfiesLevel` is the same function the guard calls, imported
   * rather than reimplemented. The two answering differently is precisely the
   * bug where the UI renders a button the API then refuses — which reads to the
   * user as a broken product rather than as a permission they lack.
   *
   * Admin-only by design: a student identity has no grants, so a shared `can`
   * would be a function that can only ever answer false.
   */
  extend: (admin) => ({
    can: (key: string, level: PermissionLevel = PERMISSION_LEVELS.READ) =>
      admin !== null && (admin.isSuperAdmin || satisfiesLevel(admin.permissions[key], level)),
  }),
});
