import { ActorTypes, AppException, ErrorCodes, type StudentIdentity } from '@iace/contracts';
import { createAuth } from '@iace/app-kit';
import { api, signOutSignal, tokenStore } from '../lib/api';
import { registerPushDevice } from '../lib/push-device';
import { ME_QUERY_KEY } from '../lib/constants';

/** Past this a read that never answers is given up on, so the retry screen replaces a splash that would hang. */
const IDENTITY_WAIT_MS = 15_000;

/** The abandoned request is left to finish on its own; the client has no signal to abort it with. */
function withinIdentityWait<T>(read: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new AppException(ErrorCodes.INTERNAL, 'Cannot reach the server. Check your connection.', {
            httpStatus: 0,
          }),
        ),
      IDENTITY_WAIT_MS,
    );
  });
  return Promise.race([read, stalled]).finally(() => clearTimeout(timer));
}

/** This app's session — `ActorTypes.STUDENT` is load-bearing, an admin's JWT is not a session here. */
export const { AuthProvider, useAuth } = createAuth<StudentIdentity>({
  actor: ActorTypes.STUDENT,
  queryKey: ME_QUERY_KEY,
  tokenStore,
  signOutSignal,
  endpoints: {
    me: () => withinIdentityWait(api.auth.me()),
    logout: async (extra) => {
      await api.auth.logout(extra);
    },
  },
  onSignedIn: () => void registerPushDevice(),
});
