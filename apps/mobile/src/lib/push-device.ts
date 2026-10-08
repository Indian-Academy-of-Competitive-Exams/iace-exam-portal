/**
 * This phone's FCM registration, and the two calls that keep the server's row honest. Best effort
 * throughout: a student who refuses the permission, or a build with no Firebase config, simply has
 * no push — the bell inside the app is the source of truth and is never affected by any of it.
 */
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import { DEVICE_PLATFORM } from '@iace/contracts';
import { settledWithin, SIGN_OUT_WAIT_MS } from '@iace/app-kit';
import { api } from './api';
import { IN_EXPO_GO, loadNotifications } from './notifications';

/** Expo hands back the platform's own token; only Android's IS an FCM one. */
const FCM_TOKEN_TYPE = 'android';

/** The token this phone last registered, so signing out drops the one the server actually holds. */
let registered: string | null = null;

let boundThisProcess = false;

/** On every sign-in, not once per process: the server binds the token to the session now open. */
export async function registerPushDevice(): Promise<void> {
  boundThisProcess = true;
  // Expo Go throws on a token since SDK 53, and iOS hands back an APNs token FCM cannot address.
  if (IN_EXPO_GO || !Device.isDevice || Platform.OS !== 'android') return;

  try {
    const token = await fcmToken();
    if (token === null) return;

    await api.me.registerPushDevice({
      token,
      platform: DEVICE_PLATFORM.ANDROID,
      deviceName: Device.modelName ?? undefined,
    });
    registered = token;
  } catch {
    // A phone that could not register is a phone without push, never a phone that cannot sign in.
  }
}

/** For a session restored from storage at launch; a sign-in registers through the auth hook instead. */
export function registerOncePerProcess(): Promise<void> {
  return boundThisProcess ? Promise.resolve() : registerPushDevice();
}

/** Called BEFORE the session ends, or the server would keep pushing this student's bell to it. */
export async function dropPushDevice(): Promise<void> {
  const token = registered;
  registered = null;
  if (token === null) return;

  // Refused or never answered, the row survives, and the next student to sign in on this phone takes the token over.
  await settledWithin(api.me.dropPushDevice({ token }), SIGN_OUT_WAIT_MS);
}

async function fcmToken(): Promise<string | null> {
  const notifications = await loadNotifications();
  if (!notifications) return null;

  const asked = await notifications.getPermissionsAsync();
  const granted = asked.granted
    ? asked
    : await notifications.requestPermissionsAsync().catch(() => null);
  if (!granted?.granted) return null;

  const device = await notifications.getDevicePushTokenAsync();
  return device.type === FCM_TOKEN_TYPE && typeof device.data === 'string' ? device.data : null;
}
