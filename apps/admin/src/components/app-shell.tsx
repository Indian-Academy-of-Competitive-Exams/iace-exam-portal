import { useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import { Badge } from '@iace/ui';
import { AppShell as Shell } from '@iace/app-kit/browser';
import { NAV_ITEMS } from '../lib/constants';
import { useAuth } from '../providers/auth';

/**
 * The admin shell: the shared chrome, this app's nav, and its own idea of who
 * is signed in.
 *
 * Wider than the student portal, because the screens behind it are tables.
 */
export function AppShell() {
  const { identity: admin, signOut, can } = useAuth();

  /**
   * A section nobody can open is not shown. Hiding is not the security — every
   * route behind these is enforced server-side by FeaturePermissionGuard — it
   * is about not offering a door that will not open.
   *
   * Filtered here rather than in the shared shell: `@iace/app-kit` must not
   * learn that a section called "Branches" exists, still less what gates it.
   */
  const nav = useMemo(
    () =>
      NAV_ITEMS.filter((item) => {
        if (item.superAdminOnly) return admin?.isSuperAdmin ?? false;
        return item.feature === undefined || can(item.feature);
      }).map(({ to, label }) => ({ to, label })),
    [admin?.isSuperAdmin, can],
  );

  return (
    <Shell
      nav={nav}
      width="wide"
      onSignOut={() => void signOut()}
      brandSuffix={<span className="text-sm font-medium text-muted-foreground">Admin</span>}
      identity={
        <>
          {admin?.isSuperAdmin ? <Badge variant="primary">Super admin</Badge> : null}
          <span className="hidden text-sm text-muted-foreground sm:inline">{admin?.email}</span>
        </>
      }
    >
      <Outlet />
    </Shell>
  );
}
