/**
 * Registers the phone once a student is signed in, and sends a tapped notification to the bell.
 * A push carries a title and a way in and nothing else, so the tap opens the list rather than
 * trying to render what it was told. In Expo Go none of this loads and the app is unaffected.
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useNavigationContainerRef, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ACCOUNT_ROUTES } from './nav';
import { NOTIFICATIONS_QUERY_KEY } from './constants';
import { linkGuard } from './link-guard';
import { loadNotifications } from './notifications';
import {
  forgetPendingToken,
  registerIfMissing,
  registerOncePerProcess,
  registerRotatedToken,
} from './push-device';
import { pushPolicy } from './push-policy';

const APP_STATE_ACTIVE = 'active' as const;

/** The root stack's name for the bell, as its file under app/ names it. */
const BELL_ROUTE = 'notifications';

export function usePushDevice(signedIn: boolean, signedOut: boolean): void {
  const router = useRouter();
  const navigation = useNavigationContainerRef();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (signedIn) void registerOncePerProcess();
    if (signedOut) void forgetPendingToken();
    if (!signedIn && !signedOut) return;
    // Coming back to the app is when a permission allowed in Settings, or a network that returned, can finish the job.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== APP_STATE_ACTIVE) return;
      void (signedIn ? registerIfMissing() : forgetPendingToken());
    });
    return () => subscription.remove();
  }, [signedIn, signedOut]);

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
          if (!pushPolicy(linkGuard.isSitting()).tapOpensBell) return;
          const routes = navigation.getRootState()?.routes ?? [];
          // Back to a bell already open beneath, never a second copy stacked over what was opened from it.
          if (routes.some((route) => route.name === BELL_ROUTE))
            router.dismissTo(ACCOUNT_ROUTES.NOTIFICATIONS);
          else router.navigate(ACCOUNT_ROUTES.NOTIFICATIONS);
        }),
        notifications.addNotificationReceivedListener(() => {
          // The bell waits while a paper is being sat: one broadcast would otherwise be a read per sitting.
          if (!pushPolicy(linkGuard.isSitting()).refreshesBell) return;
          void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
        }),
        notifications.addPushTokenListener((token) => {
          if (typeof token.data === 'string') void registerRotatedToken(token.data);
        }),
      );
    });

    return () => {
      listening = false;
      for (const subscription of held) subscription.remove();
    };
  }, [signedIn, router, navigation, queryClient]);
}
