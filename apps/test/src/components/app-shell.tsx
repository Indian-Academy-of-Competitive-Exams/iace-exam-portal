import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Avatar, PageHeader } from '@iace/ui';
import { AppShell as Shell } from '@iace/app-kit/browser';
import { api } from '../lib/api';
import { NAV_ITEMS, PROFILE_QUERY_KEY, ROUTES, USER_MENU_ITEMS } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { ChangePinCard } from '../routes/account';

/** The student's shell. Same width as the admin's, so neither wastes the screen it is on. */
export function AppShell() {
  const { identity: student, signOut } = useAuth();
  // Shared cache entry with the profile screens, so a new photo shows in the
  // header the moment it uploads rather than on the next reload.
  const me = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: () => api.me.profile() });

  return (
    <Shell
      nav={NAV_ITEMS}
      width="wide"
      homeTo={ROUTES.HOME}
      onSignOut={() => void signOut()}
      userMenuItems={USER_MENU_ITEMS}
      userLabel={student?.fullName ?? `+91 ${student?.mobile ?? ''}`}
      userAvatar={
        <Avatar
          src={me.data?.profile?.photoUrl}
          name={student?.fullName}
          fallback={student?.mobile}
          size="sm"
        />
      }
      // No `can`: the student portal has no permissions, so every section
      // shows. filterNavByPermission is deliberately lenient about that.
    >
      {/*
        A student still on the PIN the institute set cannot get past this.
        Not a banner they can scroll past: the PIN is the first four digits of
        their own mobile number, so anyone holding the class list can sign in
        as them — and every test they sit until they change it is a result
        somebody else could have produced.

        It sits INSIDE the shell rather than being a redirect, so the header
        and Log out stay reachable and there is no navigation to fight.
      */}
      {student?.hasDefaultPin ? (
        <DefaultPinGate />
      ) : (
        <>
          {student?.isTestBlocked ? <TestBlockedBanner /> : null}
          <Outlet />
        </>
      )}
    </Shell>
  );
}

function DefaultPinGate() {
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="PIN" />
      <ChangePinCard onDefaultPin />
    </div>
  );
}

/**
 * A banner and not a gate: sign-in, history and results are all still theirs, and the server is
 * what refuses a new attempt. Saying nothing would leave them pressing Start and being turned away.
 */
function TestBlockedBanner() {
  return (
    <div className="mb-5">
      <Alert variant="warning">
        <span>
          Tests are on hold for you at the moment. Everything you have already sat, and your
          results, stay here. Ask at your branch office to have it lifted.
        </span>
      </Alert>
    </div>
  );
}
