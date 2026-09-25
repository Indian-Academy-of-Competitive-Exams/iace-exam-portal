import { createApiClient, CLIENT_HEADERS, type ClientKind } from '@iace/contracts';
import { type TokenStore } from './token-store';
import { type SignOutSignal } from './sign-out-signal';
import { signOutReasonOf } from './signed-out-message';

/** One typed client per app; refreshes an expired access token transparently and raises the sign-out signal when the refresh token is gone. Storage and signal are adapters. */
export function createAppApiClient(options: {
  baseUrl: string;
  tokenStore: TokenStore;
  signOutSignal: SignOutSignal;
  /** Which app this is; the server keeps one session of each kind per student. */
  client: { kind: ClientKind; deviceName?: string | null };
}) {
  const { baseUrl, tokenStore, signOutSignal, client } = options;

  return createApiClient({
    baseUrl,
    headers: clientHeaders(client),
    getAccessToken: () => tokenStore.get()?.accessToken ?? null,
    getRefreshToken: () => tokenStore.get()?.refreshToken ?? null,
    onTokensRefreshed: (tokens) => tokenStore.set(tokens),
    onUnauthorized: (cause) => {
      tokenStore.clear();
      signOutSignal.emit(signOutReasonOf(cause));
    },
  });
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

/** The whole typed client, as the one seam a portable hook takes instead of importing an app's. */
export type AppApiClient = ReturnType<typeof createAppApiClient>;
