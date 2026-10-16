import { useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FEATURE_KEYS } from '@iace/contracts';
import { Badge, EmptyState, EMPTY_STATE_KINDS, PageHeader } from '@iace/ui';
import {
  AppShell as Shell,
  browserStorage,
  TourProvider,
  TourTrigger,
} from '@iace/app-kit/browser';
import { api } from '../lib/api';
import { NAV_ITEMS } from '../lib/nav';
import { QUERY_KEYS } from '../lib/query-keys';
import { ROUTES, STORAGE_KEYS } from '../lib/constants';
import { filterAdminNav } from '../lib/route-access';
import { useAuth } from '../providers/auth';

const UNCLAIMED_POLL_MS = 60_000;

// can goes to the shell, which reads featureKey; superAdminOnly and a route's own guard are neither, so both are applied here.
export function AppShell() {
  const { identity: admin, signOut, can } = useAuth();

  const isDeactivated = admin !== null && !admin.isActive;

  const isSuperAdmin = admin?.isSuperAdmin ?? false;

  // A deactivated admin keeps their session but loses the nav.
  const nav = useMemo(
    () => (isDeactivated ? [] : filterAdminNav(NAV_ITEMS, { isSuperAdmin, can })),
    [isDeactivated, isSuperAdmin, can],
  );

  const unclaimed = useQuery({
    queryKey: QUERY_KEYS.SUPPORT_UNCLAIMED,
    queryFn: () => api.admin.support.unclaimedCount(),
    refetchInterval: UNCLAIMED_POLL_MS,
    enabled: !isDeactivated && can(FEATURE_KEYS.SUPPORT),
  });
  const unclaimedCount = unclaimed.data ?? 0;
  const navBadges = useMemo(() => ({ [ROUTES.SUPPORT]: unclaimedCount }), [unclaimedCount]);

  return (
    <TourProvider storage={browserStorage} storageKey={STORAGE_KEYS.TOURS}>
      <Shell
        nav={nav}
        can={can}
        headerEnd={<TourTrigger />}
        width="wide"
        homeTo={ROUTES.HOME}
        portal="Admin"
        onSignOut={() => void signOut()}
        navBadges={navBadges}
        userLabel={admin?.email ?? ''}
        // No account entries: an admin signs in with an emailed code and has no profile screen.
        brandSuffix={admin?.isSuperAdmin ? <Badge variant="primary">Super admin</Badge> : null}
      >
        {isDeactivated ? <DeactivatedNotice /> : <Outlet />}
      </Shell>
    </TourProvider>
  );
}

// Deactivated admins are let in on purpose — refusing login would answer a real account as invalid.
function DeactivatedNotice() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Access removed" />
      <EmptyState
        kind={EMPTY_STATE_KINDS.REFUSED}
        title="Every section is closed to you"
        hint="Nothing you created has been deleted; a super admin can restore your access."
      />
    </div>
  );
}
