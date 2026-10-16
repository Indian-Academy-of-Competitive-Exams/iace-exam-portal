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
import { STORAGE_KEYS } from './constants';
import { IN_EXPO_GO, loadNotifications } from './notifications';
import { sittingStorage } from './sitting-store';

/** Expo hands back the platform's own token; only Android's IS an FCM one. */
const FCM_TOKEN_TYPE = 'android';

/** The token this phone last registered, so signing out drops the one the server actually holds. */
let registered: string | null = null;

let boundThisProcess = false;

const PENDING = '1';

/** Expo Go throws on a token since SDK 53, and iOS hands back an APNs token FCM cannot address. */
const canPush = () => !IN_EXPO_GO && Device.isDevice && Platform.OS === 'android';

/** On every sign-in, not once per process: the server binds the token to the session now open. */
export async function registerPushDevice(): Promise<void> {
  boundThisProcess = true;
  if (!canPush()) return;
  // This sign-in takes the token over on the server, so the last student's pushes stop without a forget.
  sittingStorage.removeItem(STORAGE_KEYS.PUSH_FORGET);
  await sendToken(await fcmToken(true).catch(() => null));
}

/** For a session restored from storage at launch; a sign-in registers through the auth hook instead. */
export function registerOncePerProcess(): Promise<void> {
  return boundThisProcess ? Promise.resolve() : registerPushDevice();
}

/** Back in the app with no registration yet: a permission allowed in Settings, or a network that came back. Never prompts. */
export async function registerIfMissing(): Promise<void> {
  if (registered !== null || !canPush()) return;
  await sendToken(await fcmToken(false).catch(() => null));
}

/** FCM rotated this install's token while the app ran; the server learns the new one now, not at the next launch. */
export function registerRotatedToken(token: string): Promise<void> {
  return canPush() ? sendToken(token) : Promise.resolve();
}

/** Called BEFORE the session ends; a drop the server never confirmed retires the token on the phone instead. */
export async function dropPushDevice(): Promise<void> {
  const token = registered;
  registered = null;
  if (!canPush()) return;

  let dropped = false;
  if (token !== null) {
    await settledWithin(
      (signal) =>
        api.me.dropPushDevice({ token }, { signal }).then(() => {
          dropped = true;
        }),
      SIGN_OUT_WAIT_MS,
    );
  }
  if (dropped) return;
  // Offline, the server still holds the token under a live session: a token FCM has retired reaches nobody.
  sittingStorage.setItem(STORAGE_KEYS.PUSH_FORGET, PENDING);
  // Not awaited: the sign-in screen tries again as it opens, so an offline phone is not held here as well.
  void forgetPendingToken();
}

/** A retirement that failed offline is tried again whenever the signed-out app is opened, until FCM confirms it. */
export async function forgetPendingToken(): Promise<void> {
  if (!canPush()) return;
  if (sittingStorage.getItem(STORAGE_KEYS.PUSH_FORGET) !== PENDING) return;

  const notifications = await loadNotifications();
  if (!notifications) return;
  const forgotten = await settledOrFalse(notifications.unregisterForNotificationsAsync());
  if (forgotten) sittingStorage.removeItem(STORAGE_KEYS.PUSH_FORGET);
}

async function sendToken(token: string | null): Promise<void> {
  if (token === null) return;
  try {
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

async function fcmToken(mayAsk: boolean): Promise<string | null> {
  const notifications = await loadNotifications();
  if (!notifications) return null;

  const asked = await notifications.getPermissionsAsync();
  const granted =
    asked.granted || !mayAsk
      ? asked
      : await notifications.requestPermissionsAsync().catch(() => null);
  if (!granted?.granted) return null;

  const device = await notifications.getDevicePushTokenAsync();
  return device.type === FCM_TOKEN_TYPE && typeof device.data === 'string' ? device.data : null;
}

/** True only when the work finished in time; a hang offline must not hold the sign-out screen. */
function settledOrFalse(work: Promise<unknown>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((done) => {
    timer = setTimeout(() => done(false), SIGN_OUT_WAIT_MS);
  });
  const finished = work.then(
    () => true,
    () => false,
  );
  return Promise.race([finished, late]).finally(() => clearTimeout(timer));
}
