/**
 * Registers the phone once a student is signed in, and sends a tapped notification to the bell.
 * A push carries a title and a way in and nothing else, so the tap opens the list rather than
 * trying to render what it was told. In Expo Go none of this loads and the app is unaffected.
 */
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ACCOUNT_ROUTES } from './nav';
import { UNREAD_QUERY_KEY } from './constants';
import { loadNotifications } from './notifications';
import { registerPushDevice } from './push-device';

/** Shown while the app is open too: a student reading one screen is not told to look elsewhere. */
const WHILE_OPEN = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: false,
  shouldSetBadge: false,
};

export function usePushDevice(signedIn: boolean): void {
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (signedIn) void registerPushDevice();
  }, [signedIn]);

  useEffect(() => {
    let listening = true;
    const held: { remove: () => void }[] = [];

    void loadNotifications().then((notifications) => {
      if (!notifications || !listening) return;

      notifications.setNotificationHandler({
        handleNotification: () => Promise.resolve(WHILE_OPEN),
      });
      held.push(
        notifications.addNotificationResponseReceivedListener(() => {
          router.navigate(ACCOUNT_ROUTES.NOTIFICATIONS);
        }),
        notifications.addNotificationReceivedListener(() => {
          void queryClient.invalidateQueries({ queryKey: UNREAD_QUERY_KEY });
        }),
      );
    });

    return () => {
      listening = false;
      for (const subscription of held) subscription.remove();
    };
  }, [router, queryClient]);
}
