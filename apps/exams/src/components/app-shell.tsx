import { useEffect, useMemo, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Avatar } from '@iace/ui';
import {
  AppShell as Shell,
  browserStorage,
  TourProvider,
  TourTrigger,
} from '@iace/app-kit/browser';
import { api } from '../lib/api';
import {
  NAV_ITEMS,
  notificationsQueryKey,
  PROFILE_QUERY_KEY,
  ROUTES,
  STORAGE_KEYS,
  UNREAD_QUERY_KEY,
  USER_MENU_ITEMS,
} from '../lib/constants';
import { onPushReceived, rebindOncePerLoad, unsubscribeFromPush } from '../lib/pwa';
import { useAuth } from '../providers/auth';

/** The student's shell. Same width as the admin's, so neither wastes the screen it is on. */
export function AppShell() {
  const { identity: student, signOut } = useAuth();
  const queryClient = useQueryClient();
  // Shared cache entry with the profile screens, so a new photo shows in the header on upload.
  const me = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: () => api.me.profile() });
  // One row is asked for because the answer wanted is `meta.total`, not the rows.
  const unread = useQuery({
    queryKey: UNREAD_QUERY_KEY,
    queryFn: () => api.me.notifications({ unreadOnly: 'true', page: 1, pageSize: 1 }),
    // Nothing polls this: a push moves it, and coming back to the tab catches whatever was missed.
    refetchOnWindowFocus: true,
  });

  useEffect(
    () => onPushReceived(() => void queryClient.invalidateQueries({ queryKey: UNREAD_QUERY_KEY })),
    [queryClient],
  );

  // Best effort: a browser that cannot re-register simply goes without push until the switch is set again.
  useEffect(() => void rebindOncePerLoad().catch(() => undefined), []);

  // A rising count is a new notification the lists have not got; a falling one is the reader reading them.
  const total = unread.data?.total ?? null;
  const counted = useRef<number | null>(null);
  useEffect(() => {
    if (total === null) return;
    const rose = counted.current !== null && total > counted.current;
    counted.current = total;
    if (!rose) return;
    for (const unreadOnly of [true, false]) {
      void queryClient.invalidateQueries({ queryKey: notificationsQueryKey(unreadOnly) });
    }
  }, [total, queryClient]);

  const unreadCount = total ?? 0;
  const navBadges = useMemo(() => ({ [ROUTES.NOTIFICATIONS]: unreadCount }), [unreadCount]);

  return (
    <TourProvider storage={browserStorage} storageKey={STORAGE_KEYS.TOURS}>
      <Shell
        nav={NAV_ITEMS}
        headerEnd={<TourTrigger />}
        width="wide"
        homeTo={ROUTES.HOME}
        onSignOut={() =>
          void unsubscribeFromPush()
            .catch(() => undefined)
            .then(signOut)
        }
        userMenuItems={USER_MENU_ITEMS}
        navBadges={navBadges}
        userLabel={student?.fullName ?? `+91 ${student?.mobile ?? ''}`}
        userAvatar={
          <Avatar
            src={me.data?.profile?.photoUrl}
            name={student?.fullName}
            fallback={student?.mobile}
            size="sm"
          />
        }
        // No `can`: the student portal has no permissions, so every section shows.
      >
        {student?.isTestBlocked ? <TestBlockedBanner /> : null}
        <Outlet />
      </Shell>
    </TourProvider>
  );
}

/** A banner, not a gate: the server refuses a new attempt — saying nothing would leave them pressing Start. */
function TestBlockedBanner() {
  return (
    <Alert variant="warning">
      <span>
        Tests are on hold for you at the moment. Everything you have already sat, and your results,
        stay here. Ask at your branch office to have it lifted.
      </span>
    </Alert>
  );
}
