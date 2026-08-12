import { createBrowserApiClient, createTokenStore } from '@iace/app-kit';
import { STORAGE_KEYS } from './constants';

/**
 * This app's session and its API client. The storage key is what keeps the
 * admin and test sessions apart on a shared origin — see `createTokenStore`.
 */
export const tokenStore = createTokenStore(STORAGE_KEYS.AUTH);

export const api = createBrowserApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
  tokenStore,
});
