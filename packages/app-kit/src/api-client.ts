import {
  createApiClient,
  createAdminApiClient,
  CLIENT_HEADERS,
  type ApiClientOptions,
  type ClientKind,
} from '@iace/contracts';
import { type TokenStore } from './token-store';
import { type SignOutSignal } from './sign-out-signal';
import { signOutReasonOf } from './signed-out-message';

/** What an app knows; storage and signal are adapters, since the client below is DOM-free. */
export interface AppClientOptions {
  baseUrl: string;
  tokenStore: TokenStore;
  signOutSignal: SignOutSignal;
  /** Which app this is; the server keeps one session of each kind per student. */
  client: { kind: ClientKind; deviceName?: string | null };
}

/** The student client: refreshes an expired access token transparently and raises the sign-out signal when the refresh token is gone. */
export const createAppApiClient = (options: AppClientOptions) => createApiClient(coreOf(options));

/** The same plumbing over the admin group. A separate factory is what keeps `admin` out of the student bundles. */
export const createAdminAppApiClient = (options: AppClientOptions) =>
  createAdminApiClient(coreOf(options));

function coreOf(options: AppClientOptions): ApiClientOptions {
  const { baseUrl, tokenStore, signOutSignal, client } = options;

  return {
    baseUrl,
    headers: clientHeaders(client),
    getAccessToken: () => tokenStore.get()?.accessToken ?? null,
    getRefreshToken: () => tokenStore.get()?.refreshToken ?? null,
    onTokensRefreshed: (tokens) => tokenStore.set(tokens),
    onUnauthorized: (cause) => {
      tokenStore.clear();
      signOutSignal.emit(signOutReasonOf(cause));
    },
  };
}

/** Header values must be printable ASCII, or fetch refuses the whole request. */
function clientHeaders(client: {
  kind: ClientKind;
  deviceName?: string | null;
}): Record<string, string> {
  const name = client.deviceName
    ?.replace(/[^\x20-\x7E]/g, '')
    .trim()
    .slice(0, 128);
  return {
    [CLIENT_HEADERS.KIND]: client.kind,
    ...(name ? { [CLIENT_HEADERS.DEVICE_NAME]: name } : {}),
  };
}

/** The student client, as the one seam a portable hook takes instead of importing an app's. */
export type AppApiClient = ReturnType<typeof createAppApiClient>;
