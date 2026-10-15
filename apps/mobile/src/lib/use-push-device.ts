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
import { linkGuard } from './link-guard';
import { loadNotifications } from './notifications';
import { registerOncePerProcess } from './push-device';
import { pushPolicy } from './push-policy';

export function usePushDevice(signedIn: boolean): void {
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (signedIn) void registerOncePerProcess();
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    let listening = true;
    const held: { remove: () => void }[] = [];

    void loadNotifications().then((notifications) => {
      if (!notifications || !listening) return;

      notifications.setNotificationHandler({
        handleNotification: () => Promise.resolve(pushPolicy(linkGuard.isSitting()).presentation),
      });
      held.push(
        notifications.addNotificationResponseReceivedListener(() => {
          // A tap must not take the phone off a running paper; the notification waits in the shade.
          if (pushPolicy(linkGuard.isSitting()).tapOpensBell) {
            router.navigate(ACCOUNT_ROUTES.NOTIFICATIONS);
          }
        }),
        notifications.addNotificationReceivedListener(() => {
          // The bell waits while a paper is being sat: one broadcast would otherwise be a read per sitting.
          if (!pushPolicy(linkGuard.isSitting()).refreshesBell) return;
          void queryClient.invalidateQueries({ queryKey: UNREAD_QUERY_KEY });
        }),
      );
    });

    return () => {
      listening = false;
      for (const subscription of held) subscription.remove();
    };
  }, [signedIn, router, queryClient]);
}
