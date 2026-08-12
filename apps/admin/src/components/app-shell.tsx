import { LogOut } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { Badge, Brandmark, Button, cn } from '@iace/ui';
import { NAV_ITEMS } from '../lib/constants';
import { useAuth } from '../providers/auth-context';
import { ThemeToggle } from './theme-toggle';

/**
 * The authed shell: one header, one nav, and the page below it. Every admin
 * screen renders inside this so the chrome is defined once rather than
 * reassembled per route.
 */
export function AppShell() {
  const { admin, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-3">
            <Brandmark withWordmark />
            <span className="text-sm font-medium text-muted-foreground">Admin</span>
          </div>

          <div className="flex items-center gap-2">
            {admin?.isSuperAdmin ? <Badge variant="primary">Super admin</Badge> : null}
            <span className="hidden text-sm text-muted-foreground sm:inline">{admin?.email}</span>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              <LogOut aria-hidden />
              Sign out
            </Button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-6xl gap-1 px-4" aria-label="Sections">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:shadow-focus',
                  isActive
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">
        <Outlet />
      </main>
    </div>
  );
}

/** One page heading treatment, so every screen opens the same way. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
