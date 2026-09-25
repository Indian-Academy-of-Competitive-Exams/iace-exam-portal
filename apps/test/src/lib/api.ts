import { createAppApiClient } from '@iace/app-kit';
import { browserSignOutSignal, createBrowserTokenStore } from '@iace/app-kit/browser';
import { CLIENT_KINDS } from '@iace/contracts';
import { STORAGE_KEYS } from './constants';

/** This app's session and API client; the storage key keeps the two SPAs' sessions apart. */
export const tokenStore = createBrowserTokenStore(STORAGE_KEYS.AUTH);

export const api = createAppApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
  tokenStore,
  signOutSignal: browserSignOutSignal,
  client: { kind: CLIENT_KINDS.WEB },
});
