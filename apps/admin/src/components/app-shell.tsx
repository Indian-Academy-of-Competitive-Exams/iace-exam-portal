import { useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import { Alert, Badge, PageHeader } from '@iace/ui';
import { AppShell as Shell } from '@iace/app-kit/browser';
import { NAV_ITEMS, filterAdminNav } from '../lib/constants';
import { useAuth } from '../providers/auth';

/**
 * The admin shell. `can` goes to the shell, which reads `featureKey`;
 * `superAdminOnly` is stripped here because it is not a feature key.
 */
export function AppShell() {
  const { identity: admin, signOut, can } = useAuth();

  const isDeactivated = admin !== null && !admin.isActive;

  // A deactivated admin keeps their session but loses the nav.
  const nav = useMemo(
    () => (isDeactivated ? [] : filterAdminNav(NAV_ITEMS, admin?.isSuperAdmin ?? false)),
    [isDeactivated, admin?.isSuperAdmin],
  );

  return (
    <Shell
      nav={nav}
      can={can}
      width="wide"
      onSignOut={() => void signOut()}
      userLabel={admin?.email ?? ''}
      // No account entries: an admin signs in with an emailed code and has no profile screen.
      brandSuffix={
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Admin</span>
          {admin?.isSuperAdmin ? <Badge variant="primary">Super admin</Badge> : null}
        </span>
      }
    >
      {isDeactivated ? <DeactivatedNotice /> : <Outlet />}
    </Shell>
  );
}

/**
 * What a deactivated admin sees instead of the app. They are let in on purpose —
 * refusing the login would answer a real account with "invalid credentials".
 */
function DeactivatedNotice() {
  return (
    <>
      <PageHeader
        title="Your access has been removed"
        description="Your account is still here, but it has been deactivated."
      />
      <Alert variant="warning">
        <span>
          Every section and action across the platform is closed to you, including anything you were
          granted before. Nothing you created has been deleted. A super admin can restore your
          access — until then there is nothing here to do.
        </span>
      </Alert>
    </>
  );
}
