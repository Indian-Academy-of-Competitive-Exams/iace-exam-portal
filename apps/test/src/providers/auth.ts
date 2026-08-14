import { ActorTypes, type StudentIdentity } from '@iace/contracts';
import { createAuth } from '@iace/app-kit';
import { api, signOutSignal, tokenStore } from '../lib/api';
import { ME_QUERY_KEY } from '../lib/constants';

/**
 * This app's session. All of the behaviour is in `createAuth`; what is here is
 * the three things that are genuinely this app's — which actor counts as a
 * session, where its identity is cached, and which client it reads through.
 *
 * `ActorTypes.STUDENT` is doing real work: an admin's token is a perfectly
 * valid JWT and must not be a session in the student portal. The server
 * enforces the same split with `@Actors`.
 */
export const { AuthProvider, useAuth } = createAuth<StudentIdentity>({
  actor: ActorTypes.STUDENT,
  queryKey: ME_QUERY_KEY,
  tokenStore,
  signOutSignal,
  endpoints: { me: () => api.auth.me(), logout: async () => void (await api.auth.logout()) },
});
