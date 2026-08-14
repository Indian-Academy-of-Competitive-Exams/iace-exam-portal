import { useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import { Badge } from '@iace/ui';
import { AppShell as Shell } from '@iace/app-kit/browser';
import { NAV_ITEMS, ROUTES, filterAdminNav } from '../lib/constants';
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

  const nav = useMemo(
    () => filterAdminNav(NAV_ITEMS, admin?.isSuperAdmin ?? false),
    [admin?.isSuperAdmin],
  );

  return (
    <Shell
      nav={nav}
      can={can}
      width="wide"
      onSignOut={() => void signOut()}
      userLabel={admin?.email ?? ''}
      profileHref={ROUTES.HOME}
      brandSuffix={
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Admin</span>
          {admin?.isSuperAdmin ? <Badge variant="primary">Super admin</Badge> : null}
        </span>
      }
    >
      <Outlet />
    </Shell>
  );
}
