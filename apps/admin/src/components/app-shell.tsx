import { useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import { Alert, Badge, PageHeader } from '@iace/ui';
import { AppShell as Shell } from '@iace/app-kit/browser';
import { NAV_ITEMS, filterAdminNav } from '../lib/constants';
import { useAuth } from '../providers/auth';

/**
 * The admin shell: the shared chrome, this app's nav, and its own idea of who
 * is signed in.
 *
 * Wider than the student portal, because the screens behind it are tables.
 *
 * Two filters, on purpose, and they are not duplicates. `can` goes to the shell
 * because `featureKey` is part of the shared NavItem shape and the shell knows
 * how to read it. `superAdminOnly` is stripped here because it is NOT a feature
 * key and must never become one — Admins, Features and Permissions are the
 * screens that decide who decides, so gating them on a grantable permission
 * would let the permission system hand out control of itself. @iace/app-kit has
 * no concept of a super admin and should not learn one.
 */
export function AppShell() {
  const { identity: admin, signOut, can } = useAuth();

  const isDeactivated = admin !== null && !admin.isActive;

  // A deactivated admin keeps their session — that is how they are told what
  // happened — but the nav goes with the access. `can` already answers false
  // for every feature; this covers the super-admin-only sections, which are
  // gated on the flag rather than on a feature key.
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
      // No account entries: an admin signs in with an emailed code, so there is
      // no password to change, and there is no admin profile screen. The menu
      // named "Profile" and pointed at the dashboard — a link that goes
      // somewhere other than where it says is worse than no link.
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
 * What a deactivated admin sees instead of the app.
 *
 * They are let in on purpose. Refusing the login would answer a real account
 * with "invalid credentials", which reads as a typo and sends someone to reset
 * a password they do not have — so they sign in and are told plainly, once,
 * what actually happened and who can undo it.
 *
 * It replaces the outlet rather than sitting above it: every screen behind it
 * would be empty of data anyway, because the server refuses each request, and
 * a page of failed requests under a banner is a worse way to learn this.
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
