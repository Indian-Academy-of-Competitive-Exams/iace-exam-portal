/**
 * This phone's FCM registration, and the two calls that keep the server's row honest. Best effort
 * throughout: a student who refuses the permission, or a build with no Firebase config, simply has
 * no push — the bell inside the app is the source of truth and is never affected by any of it.
 */
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import { DEVICE_PLATFORM } from '@iace/contracts';
import { api } from './api';
import { IN_EXPO_GO, loadNotifications } from './notifications';

/** Expo hands back the platform's own token; only Android's IS an FCM one. */
const FCM_TOKEN_TYPE = 'android';

/** The token this phone last registered, so signing out drops the one the server actually holds. */
let registered: string | null = null;

/** Android only: iOS hands back an APNs token, which FCM cannot address without its own iOS SDK. */
export async function registerPushDevice(): Promise<void> {
  // Expo Go dropped Android push in SDK 53, and asking it for a token THROWS rather than declining.
  if (IN_EXPO_GO || !Device.isDevice || Platform.OS !== 'android') return;

  try {
    const token = await fcmToken();
    if (token === null || token === registered) return;

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

/** Called BEFORE the session ends, or the server would keep pushing this student's bell to it. */
export async function dropPushDevice(): Promise<void> {
  const token = registered;
  registered = null;
  if (token === null) return;

  try {
    await api.me.dropPushDevice({ token });
  } catch {
    // The row survives, and the next student to sign in on this phone takes the token over.
  }
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
