import { createAppApiClient } from '@iace/app-kit';
import { browserSignOutSignal, createBrowserTokenStore } from '@iace/app-kit/browser';
import { CLIENT_KINDS } from '@iace/contracts';
import { STORAGE_KEYS } from './constants';

// The storage key keeps the two SPAs' sessions apart; browser adapters are passed in since the client is DOM-free.
export const tokenStore = createBrowserTokenStore(STORAGE_KEYS.AUTH);

export const signOutSignal = browserSignOutSignal;

export const api = createAppApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
  tokenStore,
  signOutSignal,
  client: { kind: CLIENT_KINDS.WEB },
});
