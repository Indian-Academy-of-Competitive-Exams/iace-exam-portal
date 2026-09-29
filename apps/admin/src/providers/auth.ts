import {
  ActorTypes,
  PERMISSION_LEVELS,
  can,
  type AdminIdentity,
  type FeatureKey,
  type PermissionLevel,
} from '@iace/contracts';
import { createAuth } from '@iace/app-kit';
import { api, signOutSignal, tokenStore } from '../lib/api';
import { QUERY_KEYS } from '../lib/constants';

// This app's session: actor, cache key, client, one admin-only read; ActorTypes.ADMIN is load-bearing since a student JWT is not a session here.
export const { AuthProvider, useAuth } = createAuth<
  AdminIdentity,
  { can: (key: FeatureKey, level?: PermissionLevel) => boolean }
>({
  actor: ActorTypes.ADMIN,
  queryKey: QUERY_KEYS.ME,
  tokenStore,
  signOutSignal,
  endpoints: {
    me: () => api.auth.me(),
    logout: async () => {
      await api.auth.logout();
    },
  },
  // The guard's own rule, so the screen cannot offer a button the API refuses.
  extend: (admin) => ({
    can: (key: FeatureKey, level: PermissionLevel = PERMISSION_LEVELS.READ) =>
      admin !== null && can(admin, key, level),
  }),
});
