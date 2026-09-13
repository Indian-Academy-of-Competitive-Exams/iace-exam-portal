import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PageCrumbs } from '@iace/app-kit/browser';
import { Alert, Badge, Button, Checkbox, PageHeader, PanelFrame, Skeleton, toast } from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, PUSH_CONFIG_QUERY_KEY } from '../lib/constants';
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

export function NotificationSettingsPage() {
  const config = useQuery({
    queryKey: PUSH_CONFIG_QUERY_KEY,
    queryFn: () => api.me.pushConfig(),
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
          Every result, test and notice lands in the bell, which stays on for everyone. SMS carries
          your sign-in codes whatever you choose here.
        </Alert>

        <InstallOffer />

        <Section title="Push notifications">
          <DividedList>
            <DividedRow
              title="This browser"
              action={
                config.isLoading ? (
                  <Skeleton variant="row" className="h-6 w-10 rounded-md" />
                ) : (
                  <PushControl publicKey={config.data?.publicKey ?? null} />
                )
              }
            />
          </DividedList>
        </Section>
      </PageBody>
    </PanelFrame>
  );
}

/** A browser that cannot carry push is named as unavailable, not drawn as a switch turned off. */
function PushControl({ publicKey }: Readonly<{ publicKey: string | null }>) {
  const subscribed = usePushSubscription();
  const push = usePushChannel(publicKey);

  if (!publicKey || !pushIsSupported()) return <Badge variant="neutral">Not available here</Badge>;

  return (
    <Checkbox
      aria-label="Push notifications in this browser"
      checked={subscribed.isOn}
      disabled={push.isPending}
      onChange={(event) =>
        push.mutate(event.target.checked, { onSuccess: () => subscribed.refresh() })
      }
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

/** Whether THIS browser holds a subscription, which is the whole switch — the server stores no other. */
function usePushSubscription() {
  const [isOn, setIsOn] = React.useState(false);

  const refresh = React.useCallback(() => {
    void currentPushSubscription().then((subscription) => setIsOn(subscription !== null));
  }, []);

  React.useEffect(refresh, [refresh]);

  return { isOn, refresh };
}

/** One write, not two: the browser subscribes or revokes, and the server holds only that endpoint. */
function usePushChannel(publicKey: string | null) {
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!enabled) {
        const endpoint = await unsubscribeFromPush();
        if (endpoint) await api.me.unsubscribeFromPush({ endpoint });
        return true;
      }

      const subscription = publicKey ? await subscribeToPush(publicKey) : null;
      if (!subscription) return false;

      await api.me.subscribeToPush(subscription);
      return true;
    },
    onSuccess: (done) => {
      if (!done) toast.info('Your browser did not allow notifications, so push stays off.');
    },
  });
}
