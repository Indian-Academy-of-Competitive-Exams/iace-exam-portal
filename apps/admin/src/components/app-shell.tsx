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
  const { identity: admin, signOut } = useAuth();

  return (
    <Shell
      nav={NAV_ITEMS}
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
