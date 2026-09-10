import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  EMPTY_STATE_KINDS,
  PageHeader,
  PanelFrame,
  Skeleton,
  toast,
} from '@iace/ui';
import { DELIVERY_CHANNEL, type NotificationPreference } from '@iace/contracts';
import { api } from '../lib/api';
import { CHANNEL_LABELS, NAV_ITEMS, NOTIFICATION_PREFERENCES_QUERY_KEY } from '../lib/constants';
import { DividedList, DividedRow, PageBody, Section } from '../components/ui';
import {
  currentPushSubscription,
  isInstallable,
  isInstalled,
  onInstallableChange,
  promptInstall,
  pushIsSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from '../lib/pwa';

const SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e'];

/** Names the gap rather than the switch: an unavailable channel is not one they turned off. */
const UNAVAILABLE = {
  [DELIVERY_CHANNEL.EMAIL]: 'No email on file',
  [DELIVERY_CHANNEL.WEB_PUSH]: 'Not available here',
} as const;

export function NotificationSettingsPage() {
  const preferences = useQuery({
    queryKey: NOTIFICATION_PREFERENCES_QUERY_KEY,
    queryFn: () => api.me.notificationPreferences(),
  });

  return (
    <PanelFrame
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} tail={[{ label: 'Settings' }]} />}
          title="Notifications"
        />
      }
    >
      <PageBody>
        <Alert variant="info">
          In-app notifications stay on for everyone — the bell is where every result, test and
          notice lands. SMS still carries your sign-in codes whatever you choose here.
        </Alert>

        <InstallOffer />

        <Section title="Channels">
          <ChannelRegion
            rows={preferences.data?.channels}
            publicKey={preferences.data?.webPushPublicKey ?? null}
            isLoading={preferences.isLoading}
            isError={preferences.isError}
            onRetry={preferences.refetch}
          />
        </Section>
      </PageBody>
    </PanelFrame>
  );
}

function ChannelRegion({
  rows,
  publicKey,
  isLoading,
  isError,
  onRetry,
}: Readonly<{
  rows: readonly NotificationPreference[] | undefined;
  publicKey: string | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}>) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {SKELETON_KEYS.map((key) => (
          <Skeleton key={key} variant="row" className="h-14 rounded-lg" />
        ))}
      </div>
    );
  }
  if (isError || !rows) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Your notification settings did not load"
        onRetry={onRetry}
      />
    );
  }

  return (
    <DividedList>
      {rows.map((row) => (
        <ChannelRow key={row.channel} row={row} publicKey={publicKey} />
      ))}
    </DividedList>
  );
}

function ChannelRow({
  row,
  publicKey,
}: Readonly<{ row: NotificationPreference; publicKey: string | null }>) {
  const isPush = row.channel === DELIVERY_CHANNEL.WEB_PUSH;
  const subscribed = usePushSubscription(isPush);
  const save = useSaveChannel();
  const push = usePushChannel(publicKey);

  const label = CHANNEL_LABELS[row.channel];
  const usable = row.available && (!isPush || pushIsSupported());
  const checked = isPush ? row.enabled && subscribed.isOn : row.enabled;

  const onChange = (enabled: boolean) => {
    if (!isPush) {
      save.mutate({ channel: row.channel, enabled });
      return;
    }
    push.mutate(enabled, { onSuccess: () => subscribed.refresh() });
  };

  return (
    <DividedRow
      title={label}
      action={
        <ChannelControl
          label={label}
          locked={row.locked}
          usable={usable}
          channel={row.channel}
          checked={checked}
          pending={save.isPending || push.isPending}
          onChange={onChange}
        />
      }
    />
  );
}

/** An action a row cannot take is left out, not disabled — with a badge naming why in its place. */
function ChannelControl({
  label,
  locked,
  usable,
  channel,
  checked,
  pending,
  onChange,
}: Readonly<{
  label: string;
  locked: boolean;
  usable: boolean;
  channel: NotificationPreference['channel'];
  checked: boolean;
  pending: boolean;
  onChange: (enabled: boolean) => void;
}>) {
  if (locked) return <Badge variant="primary">Always on</Badge>;
  if (!usable) {
    return <Badge variant="neutral">{UNAVAILABLE[channel as keyof typeof UNAVAILABLE]}</Badge>;
  }

  return (
    <Checkbox
      aria-label={label}
      checked={checked}
      disabled={pending}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

/** The offer only exists while the browser is making it, and never once the app is installed. */
function InstallOffer() {
  const [offered, setOffered] = React.useState(() => isInstallable() && !isInstalled());

  React.useEffect(
    () => onInstallableChange(() => setOffered(isInstallable() && !isInstalled())),
    [],
  );

  if (!offered) return null;

  return (
    <Alert variant="info">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>Install IACE to open it from your home screen and receive push notifications.</span>
        <Button size="sm" variant="outline" onClick={() => void promptInstall()}>
          Install app
        </Button>
      </div>
    </Alert>
  );
}

/** Whether THIS browser holds a subscription — the server's preference alone cannot say. */
function usePushSubscription(enabled: boolean) {
  const [isOn, setIsOn] = React.useState(false);

  const refresh = React.useCallback(() => {
    if (!enabled) return;
    void currentPushSubscription().then((subscription) => setIsOn(subscription !== null));
  }, [enabled]);

  React.useEffect(refresh, [refresh]);

  return { isOn, refresh };
}

function useSaveChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.me.setNotificationPreference,
    onSuccess: (set) => queryClient.setQueryData(NOTIFICATION_PREFERENCES_QUERY_KEY, set),
  });
}

/** Push is two writes that must agree: the browser's subscription, then the preference behind it. */
function usePushChannel(publicKey: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!enabled) {
        const endpoint = await unsubscribeFromPush();
        if (endpoint) await api.me.unsubscribeFromPush({ endpoint });
        return api.me.setNotificationPreference({
          channel: DELIVERY_CHANNEL.WEB_PUSH,
          enabled: false,
        });
      }

      const subscription = publicKey ? await subscribeToPush(publicKey) : null;
      if (!subscription) return null;

      await api.me.subscribeToPush(subscription);
      return api.me.setNotificationPreference({
        channel: DELIVERY_CHANNEL.WEB_PUSH,
        enabled: true,
      });
    },
    onSuccess: (set) => {
      if (set) queryClient.setQueryData(NOTIFICATION_PREFERENCES_QUERY_KEY, set);
      else toast.info('Your browser did not allow notifications, so push stays off.');
    },
  });
}
