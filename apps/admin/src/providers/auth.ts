import { ActorTypes, type AdminIdentity } from '@iace/contracts';
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
  { canAccess: (pageCode: string) => boolean }
>({
  actor: ActorTypes.ADMIN,
  queryKey: ME_QUERY_KEY,
  tokenStore,
  signOutSignal,
  endpoints: { me: () => api.auth.me(), logout: async () => void (await api.auth.logout()) },
  // Mirrors the server-side PagePermissionGuard: super admins bypass checks.
  // Admin-only by design — a student identity has no pages, so a shared
  // `canAccess` would be a function that can only ever answer false.
  extend: (admin) => ({
    canAccess: (pageCode: string) =>
      admin !== null && (admin.isSuperAdmin || admin.pages.includes(pageCode)),
  }),
});
