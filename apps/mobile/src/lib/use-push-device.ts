/**
 * Registers the phone once a student is signed in, and sends a tapped notification to the bell.
 * A push carries a title and a way in and nothing else, so the tap opens the list rather than
 * trying to render what it was told.
 */
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { ACCOUNT_ROUTES } from './nav';
import { UNREAD_QUERY_KEY } from './constants';
import { registerPushDevice } from './push-device';

/** Shown while the app is open too: a student reading one screen is not told to look elsewhere. */
Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
});

export function usePushDevice(signedIn: boolean): void {
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (signedIn) void registerPushDevice();
  }, [signedIn]);

  useEffect(() => {
    const tapped = Notifications.addNotificationResponseReceivedListener(() => {
      router.navigate(ACCOUNT_ROUTES.NOTIFICATIONS);
    });
    const arrived = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries({ queryKey: UNREAD_QUERY_KEY });
    });

    return () => {
      tapped.remove();
      arrived.remove();
    };
  }, [router, queryClient]);
}
