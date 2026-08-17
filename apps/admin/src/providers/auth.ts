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
 * This app's session: the actor, the cache key, the client, and one admin-only read.
 * `ActorTypes.ADMIN` is load-bearing — a student's JWT is valid and is not a session here.
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
   * Mirrors FeaturePermissionGuard, sharing `satisfiesLevel` rather than reimplementing it.
   * The two disagreeing is the bug where the UI offers a button the API refuses.
   */
  extend: (admin) => ({
    can: (key: string, level: PermissionLevel = PERMISSION_LEVELS.READ) =>
      // isActive first, gating the super-admin bypass too — the server's order.
      admin !== null &&
      admin.isActive &&
      (admin.isSuperAdmin || satisfiesLevel(admin.permissions[key], level)),
  }),
});
