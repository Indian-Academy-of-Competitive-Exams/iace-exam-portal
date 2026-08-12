import { createApiClient } from '@iace/contracts';
import { SIGNED_OUT_EVENT, type TokenStore } from './token-store';

/**
 * One client per app, typed end to end by @iace/contracts. It refreshes expired
 * access tokens transparently and tells the app to sign out when the refresh
 * token is gone too.
 *
 * The wiring between "where tokens are kept" and "what happens when they run
 * out" is identical in every SPA, and getting it subtly different in one of
 * them is how an app ends up retrying forever with a dead token instead of
 * returning to the login screen.
 */
export function createBrowserApiClient(options: { baseUrl: string; tokenStore: TokenStore }) {
  const { baseUrl, tokenStore } = options;

  return createApiClient({
    baseUrl,
    getAccessToken: () => tokenStore.get()?.accessToken ?? null,
    getRefreshToken: () => tokenStore.get()?.refreshToken ?? null,
    onTokensRefreshed: (tokens) => tokenStore.set(tokens),
    onUnauthorized: () => {
      tokenStore.clear();
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    },
  });
}
