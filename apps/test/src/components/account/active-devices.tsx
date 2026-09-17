import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CLIENT_KINDS,
  instituteDateTimeLabel,
  type ClientKind,
  type DeviceSession,
} from '@iace/contracts';
import { Button, ConfirmDialog, EmptyState, EMPTY_STATE_KINDS } from '@iace/ui';
import { api } from '../../lib/api';
import { ACTIVE_DEVICES_QUERY_KEY } from '../../lib/constants';
import { DividedList, DividedRow, RowsSkeleton, Section } from '../ui';

const CLIENT_LABEL: Readonly<Record<ClientKind, string>> = {
  [CLIENT_KINDS.WEB]: 'Web',
  [CLIENT_KINDS.MOBILE]: 'Phone',
};

export function ActiveDevices() {
  const sessions = useQuery({
    queryKey: ACTIVE_DEVICES_QUERY_KEY,
    queryFn: () => api.me.sessions(),
  });

  return (
    <Section title="Active devices">
      {sessions.isPending ? <RowsSkeleton rows={2} /> : null}
      {sessions.isError ? (
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="Could not load your devices"
          onRetry={sessions.refetch}
        />
      ) : null}
      {sessions.data ? (
        <DividedList>
          {sessions.data.map((session) => (
            <DeviceRow key={session.id} session={session} />
          ))}
        </DividedList>
      ) : null}
    </Section>
  );
}

function DeviceRow({ session }: Readonly<{ session: DeviceSession }>) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = React.useState(false);
  const deviceName = session.deviceName ?? 'Unknown device';
  const kind = session.client ? CLIENT_LABEL[session.client] : 'Device';

  const signOut = useMutation({
    meta: { success: 'Signed out' },
    mutationFn: (id: string) => api.me.signOutSession(id),
    onSuccess: () => setConfirming(false),
    // Also on failure: a NOT_FOUND means the list is already out of date.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACTIVE_DEVICES_QUERY_KEY }),
  });

  return (
    <>
      <DividedRow
        title={deviceName}
        meta={`${kind} · Last active ${instituteDateTimeLabel(session.lastSeenAt)}`}
        action={
          session.current ? (
            <span className="text-sm text-muted-foreground">This device</span>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
              Sign out
            </Button>
          )
        }
      />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Sign out ${deviceName}?`}
        description="That device returns to the sign-in screen at its next request. Anything it has not saved stays on it until the student signs in there again."
        confirmLabel="Sign out"
        destructive
        loading={signOut.isPending}
        onConfirm={() => signOut.mutate(session.id)}
      />
    </>
  );
}
