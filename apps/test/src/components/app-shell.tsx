import { Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Avatar, PageHeader } from '@iace/ui';
import { AppShell as Shell } from '@iace/app-kit/browser';
import { api } from '../lib/api';
import { NAV_ITEMS, PROFILE_QUERY_KEY, USER_MENU_ITEMS } from '../lib/constants';
import { useAuth } from '../providers/auth';
import { ChangePinCard } from '../routes/account';

/**
 * The student's shell: the shared chrome, this app's nav, and its own idea of
 * who is signed in.
 *
 * Narrower than the admin's on purpose. A student arrives to do one thing —
 * take a test, or read what happened in the last one — and a page that runs the
 * full width of a monitor makes finding it harder rather than easier.
 */
export function AppShell() {
  const { identity: student, signOut } = useAuth();
  // Shared cache entry with the profile screens, so a new photo shows in the
  // header the moment it uploads rather than on the next reload.
  const me = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: () => api.me.profile() });

  return (
    <Shell
      nav={NAV_ITEMS}
      width="narrow"
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
      {student?.hasDefaultPin ? <DefaultPinGate /> : <Outlet />}
    </Shell>
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
