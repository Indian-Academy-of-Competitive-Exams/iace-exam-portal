import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { createAppApiClient, createTokenStore } from '@iace/app-kit';
import { createSecureStorage } from './secure-storage';
import { createSignOutSignal } from './sign-out-signal';
import { STORAGE_KEYS } from './constants';

/** This app's session and API client — `hydrate()` must resolve before anything reads the token. */
const { storage, hydrate } = createSecureStorage([STORAGE_KEYS.AUTH], SecureStore);

export { hydrate };

export const signOutSignal = createSignOutSignal();
export const tokenStore = createTokenStore(STORAGE_KEYS.AUTH, storage);

const apiUrl: string = Constants.expoConfig?.extra?.apiUrl ?? 'http://localhost:3000';

export const api = createAppApiClient({
  baseUrl: apiUrl,
  tokenStore,
  signOutSignal,
});
