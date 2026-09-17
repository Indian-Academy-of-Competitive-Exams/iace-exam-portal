import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { createAppApiClient, createTokenStore } from '@iace/app-kit';
import { CLIENT_KINDS } from '@iace/contracts';
import { devApiUrl } from './dev-api-url';
import { createSecureStorage } from './secure-storage';
import { createSignOutSignal } from './sign-out-signal';
import { STORAGE_KEYS } from './constants';

/** This app's session and API client — `hydrate()` must resolve before anything reads the token. */
const { storage, hydrate } = createSecureStorage([STORAGE_KEYS.AUTH], SecureStore);

export { hydrate };

export const signOutSignal = createSignOutSignal();
export const tokenStore = createTokenStore(STORAGE_KEYS.AUTH, storage);

// Set, it wins; unset in development, the machine serving the bundle is the machine serving the API.
const apiUrl =
  process.env.EXPO_PUBLIC_API_URL ??
  (__DEV__ ? devApiUrl(Constants.expoConfig?.hostUri, Platform.OS) : undefined);
if (!apiUrl) {
  throw new Error(
    'EXPO_PUBLIC_API_URL is not set: a release build needs it in apps/mobile/.env (see .env.example).',
  );
}

export const api = createAppApiClient({
  baseUrl: apiUrl,
  tokenStore,
  signOutSignal,
  client: { kind: CLIENT_KINDS.MOBILE, deviceName: Device.modelName },
});
