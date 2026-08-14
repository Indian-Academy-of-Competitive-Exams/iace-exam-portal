import { createAppApiClient } from '@iace/app-kit';
import { browserSignOutSignal, createBrowserTokenStore } from '@iace/app-kit/browser';
import { STORAGE_KEYS } from './constants';

/**
 * This app's session and its API client. The storage key is what keeps the
 * admin and test sessions apart on a shared origin — see `createTokenStore`.
 *
 * The two browser adapters are passed in here because this is the app: the
 * client itself is DOM-free so mobile can reuse it (docs/03 §3).
 */
export const tokenStore = createBrowserTokenStore(STORAGE_KEYS.AUTH);

export const signOutSignal = browserSignOutSignal;

export const api = createAppApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
  tokenStore,
  signOutSignal,
});
