/**
 * expo-notifications, loaded only where it works. Expo Go dropped Android remote push in SDK 53
 * and the module throws there as it loads, which took the router down with it — so in Expo Go it
 * is never imported at all, and the app runs with no push rather than no screens.
 */
import Constants from 'expo-constants';
// Type-only, so it is erased: naming the module here must not be what loads it.
import type * as ExpoNotifications from 'expo-notifications';

/** `executionEnvironment` cannot tell these apart: Expo Go and a development build are both storeClient. */
export const IN_EXPO_GO = Constants.appOwnership === 'expo';

export type NotificationsModule = typeof ExpoNotifications;

/** Null in Expo Go. Imported dynamically, since a static import would run the module regardless. */
export const loadNotifications = async (): Promise<NotificationsModule | null> =>
  IN_EXPO_GO ? null : import('expo-notifications');
