import { createApiClient } from '@iace/contracts';
import { SIGNED_OUT_EVENT, tokenStore } from './token-store';

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/**
 * One client for the whole app, typed end to end by @iace/contracts. It
 * refreshes expired access tokens transparently and tells the app to sign out
 * when the refresh token is gone too.
 */
export const api = createApiClient({
  baseUrl,
  getAccessToken: () => tokenStore.get()?.accessToken ?? null,
  getRefreshToken: () => tokenStore.get()?.refreshToken ?? null,
  onTokensRefreshed: (tokens) => tokenStore.set(tokens),
  onUnauthorized: () => {
    tokenStore.clear();
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  },
});
