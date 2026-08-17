import { createAppApiClient } from '@iace/app-kit';
import { browserSignOutSignal, createBrowserTokenStore } from '@iace/app-kit/browser';
import { STORAGE_KEYS } from './constants';

/**
 * This app's session and API client. The storage key keeps the two SPAs' sessions apart.
 * The browser adapters are passed in here because the client itself is DOM-free.
 */
export const tokenStore = createBrowserTokenStore(STORAGE_KEYS.AUTH);

export const signOutSignal = browserSignOutSignal;

export const api = createAppApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
  tokenStore,
  signOutSignal,
});
