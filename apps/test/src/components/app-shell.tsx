import { LogOut } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Avatar, Brandmark, Button, ThemeToggle, cn } from '@iace/ui';
import { api } from '../lib/api';
import { ME_QUERY_KEY, NAV_ITEMS } from '../lib/constants';
import { useAuth } from '../providers/auth-context';
import { ChangePinCard } from '../routes/account';

/**
 * The signed-in shell: one header, one nav, and the page below it.
 *
 * Kept lighter than the admin's on purpose. A student arrives to do one thing —
 * take a test, or read what happened in the last one — and a portal that opens
 * with a row of management tabs is answering a question they did not ask.
 */
export function AppShell() {
  const { student, signOut } = useAuth();
  // Shared cache entry with the profile screens, so a new photo shows in the
  // header the moment it uploads rather than on the next reload.
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => api.me.profile() });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <Brandmark withWordmark />

          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-2 sm:inline-flex">
              <Avatar
                src={me.data?.profile?.photoUrl}
                name={student?.fullName}
                fallback={student?.mobile}
                size="sm"
              />
              <span className="text-sm text-muted-foreground">
                {student?.fullName ?? `+91 ${student?.mobile ?? ''}`}
              </span>
            </span>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              <LogOut aria-hidden />
              Sign out
            </Button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-5xl gap-1 px-6">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'rounded-t-sm border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  'focus-visible:shadow-focus focus-visible:outline-none',
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

      <main className="mx-auto max-w-5xl px-6 py-8">
        {/*
          A student still on the PIN the institute set cannot get past this.
          Not a banner they can scroll past: the PIN is the first four digits of
          their own mobile number, so anyone holding the class list can sign in
          as them — and every test they sit until they change it is a result
          somebody else could have produced.

          It sits INSIDE the shell rather than being a redirect, so the header
          and Sign out stay reachable and there is no navigation to fight.
        */}
        {student?.hasDefaultPin ? <DefaultPinGate /> : <Outlet />}
      </main>
    </div>
  );
}

function DefaultPinGate() {
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Choose your own PIN"
        description="One step before you can carry on. It takes a moment."
      />
      <ChangePinCard onDefaultPin />
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: Readonly<{
  title: string;
  description?: string;
  action?: React.ReactNode;
}>) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
