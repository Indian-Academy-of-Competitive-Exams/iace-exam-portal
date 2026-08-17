import { createApiClient } from '@iace/contracts';
import { type TokenStore } from './token-store';
import { type SignOutSignal } from './sign-out-signal';

/**
 * One typed client per app. Refreshes an expired access token transparently and
 * raises the sign-out signal when the refresh token is gone. Storage and signal are adapters.
 */
export function createAppApiClient(options: {
  baseUrl: string;
  tokenStore: TokenStore;
  signOutSignal: SignOutSignal;
}) {
  const { baseUrl, tokenStore, signOutSignal } = options;

  return createApiClient({
    baseUrl,
    getAccessToken: () => tokenStore.get()?.accessToken ?? null,
    getRefreshToken: () => tokenStore.get()?.refreshToken ?? null,
    onTokensRefreshed: (tokens) => tokenStore.set(tokens),
    onUnauthorized: () => {
      tokenStore.clear();
      signOutSignal.emit();
    },
  });
}
