import { useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import { Badge, EmptyState, EMPTY_STATE_KINDS, PageHeader } from '@iace/ui';
import {
  AppShell as Shell,
  browserStorage,
  TourProvider,
  TourTrigger,
} from '@iace/app-kit/browser';
import { NAV_ITEMS, ROUTES, STORAGE_KEYS, filterAdminNav } from '../lib/constants';
import { useAuth } from '../providers/auth';

// can goes to the shell, which reads featureKey; superAdminOnly is stripped here since it isn't one.
export function AppShell() {
  const { identity: admin, signOut, can } = useAuth();

  const isDeactivated = admin !== null && !admin.isActive;

  const isSuperAdmin = admin?.isSuperAdmin ?? false;

  // A deactivated admin keeps their session but loses the nav.
  const nav = useMemo(
    () => (isDeactivated ? [] : filterAdminNav(NAV_ITEMS, { isSuperAdmin })),
    [isDeactivated, isSuperAdmin],
  );

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
