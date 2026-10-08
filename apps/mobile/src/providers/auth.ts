import { ActorTypes, type StudentIdentity } from '@iace/contracts';
import { createAuth } from '@iace/app-kit';
import { api, signOutSignal, tokenStore } from '../lib/api';
import { registerPushDevice } from '../lib/push-device';
import { ME_QUERY_KEY } from '../lib/constants';

/** This app's session — `ActorTypes.STUDENT` is load-bearing, an admin's JWT is not a session here. */
export const { AuthProvider, useAuth } = createAuth<StudentIdentity>({
  actor: ActorTypes.STUDENT,
  queryKey: ME_QUERY_KEY,
  tokenStore,
  signOutSignal,
  endpoints: {
    me: () => api.auth.me(),
    logout: async (extra) => {
      await api.auth.logout(extra);
    },
  },
  onSignedIn: () => void registerPushDevice(),
});
