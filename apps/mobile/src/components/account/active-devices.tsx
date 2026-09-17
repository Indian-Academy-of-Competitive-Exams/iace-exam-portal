import { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CLIENT_KINDS,
  instituteDateTimeLabel,
  type ClientKind,
  type DeviceSession,
} from '@iace/contracts';
import { api } from '../../lib/api';
import { ACTIVE_DEVICES_QUERY_KEY } from '../../lib/constants';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { EmptyState, EMPTY_STATE_KINDS } from '../ui/empty-state';
import { Skeleton } from '../ui/skeleton';

const CLIENT_LABELS: Readonly<Record<ClientKind, string>> = {
  [CLIENT_KINDS.WEB]: 'Web',
  [CLIENT_KINDS.MOBILE]: 'Phone',
};

const clientLabelOf = (client: DeviceSession['client']) =>
  client ? CLIENT_LABELS[client] : 'Device';

/** Where this account is signed in, with Sign out for every device but this one. */
export function ActiveDevices() {
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState<DeviceSession | null>(null);

  const sessions = useQuery({
    queryKey: ACTIVE_DEVICES_QUERY_KEY,
    queryFn: () => api.me.sessions(),
  });

  const signOutSession = useMutation({
    meta: { success: 'Signed out' },
    mutationFn: (id: string) => api.me.signOutSession(id),
    onSuccess: () => {
      setSigningOut(null);
      void queryClient.invalidateQueries({ queryKey: ACTIVE_DEVICES_QUERY_KEY });
    },
  });

  if (sessions.isLoading) {
    return (
      <View className="gap-3">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </View>
    );
  }

  if (sessions.isError) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Devices did not load"
        onRetry={sessions.refetch}
      />
    );
  }

  return (
    <>
      <Card>
        {(sessions.data ?? []).map((session, index) => (
          <DeviceRow
            key={session.id}
            session={session}
            isFirst={index === 0}
            onSignOut={() => setSigningOut(session)}
          />
        ))}
      </Card>

      <ConfirmDialog
        open={signingOut !== null}
        title={`Sign out ${signingOut?.deviceName ?? 'Unknown device'}?`}
        description="That device returns to the sign-in screen at its next request. Anything it has not saved stays on it until the student signs in there again."
        confirmLabel="Sign out"
        loading={signOutSession.isPending}
        onConfirm={() => signingOut && signOutSession.mutate(signingOut.id)}
        onCancel={() => setSigningOut(null)}
      />
    </>
  );
}

function DeviceRow({
  session,
  isFirst,
  onSignOut,
}: Readonly<{ session: DeviceSession; isFirst: boolean; onSignOut: () => void }>) {
  return (
    <View
      className={cn(
        'flex-row items-center justify-between gap-3 p-4',
        !isFirst && 'border-t border-border',
      )}
    >
      <View className="shrink gap-0.5">
        <Text className="text-sm font-semibold text-foreground">
          {session.deviceName ?? 'Unknown device'}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {clientLabelOf(session.client)} · Last active {instituteDateTimeLabel(session.lastSeenAt)}
        </Text>
      </View>

      {session.current ? (
        <Text className="text-xs text-muted-foreground">This device</Text>
      ) : (
        <Button variant="outline" size="sm" onPress={onSignOut}>
          Sign out
        </Button>
      )}
    </View>
  );
}
