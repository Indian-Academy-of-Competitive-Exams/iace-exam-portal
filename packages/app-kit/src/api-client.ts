import { createApiClient } from '@iace/contracts';
import { type TokenStore } from './token-store';
import { type SignOutSignal } from './sign-out-signal';

/**
 * One client per app, typed end to end by @iace/contracts. It refreshes expired
 * access tokens transparently and tells the app to sign out when the refresh
 * token is gone too.
 *
 * The wiring between "where tokens are kept" and "what happens when they run
 * out" is identical in every SPA, and getting it subtly different in one of
 * them is how an app ends up retrying forever with a dead token instead of
 * returning to the login screen.
 *
 * Both halves arrive as adapters, so this file has no platform in it: the web
 * apps pass the localStorage store and the window-event signal from
 * `@iace/app-kit/browser` (docs/03 §3).
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
